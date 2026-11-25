import java.io.BufferedReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.sql.Blob;
import java.sql.Clob;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.PreparedStatement;
import java.sql.SQLFeatureNotSupportedException;
import java.sql.Types;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Properties;

/** Private, one-operation JDBC bridge. All connection secrets arrive through stdin. */
public final class IdeDatabaseBridge {
  // A redirected System.out can use the host's ASCII console encoding even when
  // file.encoding is UTF-8. The JSON transport must choose its own encoding.
  private static final PrintWriter OUTPUT = new PrintWriter(
      new OutputStreamWriter(System.out, StandardCharsets.UTF_8), true);
  private static final int MAX_TABLES = 256;
  private static final int MAX_COLUMNS = 128;
  private static final int MAX_ROWS = 200;
  private static final int MAX_CELL_CHARS = 16 * 1024;
  private static final int MAX_RESULT_CHARS = 250_000;
  private static final int MAX_NAME_CHARS = 512;

  private IdeDatabaseBridge() {}

  public static void main(String[] args) {
    try {
      if (args.length != 1 || !(args[0].equals("inspect") || args[0].equals("execute") || args[0].equals("session"))) {
        throw new IllegalArgumentException();
      }
      BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.US_ASCII));
      String url = readField(input);
      String username = readField(input);
      String password = readField(input);
      String sql = readField(input);
      List<Parameter> parameters = readParameters(input);
      Properties properties = new Properties();
      if (!username.isEmpty()) properties.setProperty("user", username);
      if (!password.isEmpty()) properties.setProperty("password", password);

      try (Connection connection = DriverManager.getConnection(url, properties)) {
        if (args[0].equals("session")) {
          session(connection, input);
        } else if (args[0].equals("inspect")) {
          OUTPUT.println(inspect(connection.getMetaData()));
        } else {
          OUTPUT.println(execute(connection, sql, parameters));
        }
      }
    } catch (ParameterException error) {
      OUTPUT.println("{\"error\":\"" + json(error.getMessage()) + "\"}");
      System.exit(2);
    } catch (SQLException error) {
      OUTPUT.println("{\"error\":\"The JDBC provider could not complete the database operation.\",\"sqlState\":\"" +
          json(error.getSQLState() == null ? "" : error.getSQLState()) + "\"}");
      System.exit(2);
    } catch (Throwable error) {
      OUTPUT.println("{\"error\":\"The database operation could not be completed.\"}");
      System.exit(2);
    }
  }

  private static String transactionState(Connection connection, int statements) throws Exception {
    DatabaseMetaData metadata = connection.getMetaData();
    return "{\"autoCommit\":" + connection.getAutoCommit() +
        ",\"supportsTransactions\":" + metadata.supportsTransactions() +
        ",\"ddlCausesCommit\":" + metadata.dataDefinitionCausesTransactionCommit() +
        ",\"statementsSinceBoundary\":" + statements + "}";
  }
  private static void sessionReply(Connection connection, long sequence, int statements, String result, String error, String sqlState) throws Exception {
    StringBuilder reply = new StringBuilder("{\"sequence\":" + sequence + ",\"session\":" + transactionState(connection, statements));
    if (error == null) reply.append(",\"result\":").append(result);
    else { reply.append(",\"error\":"); appendString(reply, error); reply.append(",\"sqlState\":"); appendString(reply, sqlState == null ? "" : sqlState); }
    OUTPUT.println(reply.append('}'));
    OUTPUT.flush();
  }
  /** One connection belongs to this worker until explicit close or transport EOF. */
  private static void session(Connection connection, BufferedReader input) throws Exception {
    int statements = 0;
    try {
      sessionReply(connection, 0, statements, inspect(connection.getMetaData()), null, null);
      long expected = 1;
      for (;;) {
        String sequenceText = input.readLine();
        if (sequenceText == null) return;
        if (sequenceText.length() > 20) throw new IllegalArgumentException();
        long sequence = Long.parseLong(sequenceText);
        if (sequence != expected++) throw new IllegalArgumentException();
        String operation = input.readLine();
        if (operation == null || operation.length() > 16) throw new IllegalArgumentException();
        try {
          String result;
          switch (operation) {
            case "inspect": result = inspect(connection.getMetaData()); break;
            case "execute":
              String sql = readField(input);
              List<Parameter> parameters = readParameters(input);
              if (!connection.getAutoCommit()) statements = Math.min(1_000_000, statements+1);
              result = execute(connection, sql, parameters); break;
            case "explain":
              String planSql = readField(input);
              List<Parameter> planParameters = readParameters(input);
              if (!connection.getAutoCommit()) statements = Math.min(1_000_000, statements+1);
              result = explain(connection, planSql, planParameters); break;
            case "begin":
              if (!connection.getMetaData().supportsTransactions() || !connection.getAutoCommit()) throw new ParameterException("This connection cannot begin another manual transaction.");
              connection.setAutoCommit(false); statements = 0;
              result = "{\"outcome\":\"transaction-started\"}"; break;
            case "commit":
              if (connection.getAutoCommit()) throw new ParameterException("Begin a manual transaction before committing.");
              connection.commit(); statements = 0;
              result = "{\"outcome\":\"committed\"}"; break;
            case "rollback":
              if (connection.getAutoCommit()) throw new ParameterException("Begin a manual transaction before rolling back.");
              connection.rollback(); statements = 0;
              result = "{\"outcome\":\"rolled-back\"}"; break;
            case "auto-commit":
              if (statements != 0) throw new ParameterException("Commit or roll back before enabling auto-commit.");
              connection.setAutoCommit(true);
              result = "{\"outcome\":\"auto-commit-enabled\"}"; break;
            case "close":
              boolean rollback = !connection.getAutoCommit();
              if (rollback) connection.rollback();
              String state = transactionState(connection, 0);
              connection.close();
              OUTPUT.println("{\"sequence\":" + sequence + ",\"session\":" + state + ",\"result\":{\"closed\":true,\"rollbackConfirmed\":" + rollback + "}}");
              OUTPUT.flush(); return;
            default: throw new IllegalArgumentException();
          }
          sessionReply(connection, sequence, statements, result, null, null);
        } catch (ParameterException error) {
          sessionReply(connection, sequence, statements, null, error.getMessage(), null);
        } catch (SQLException error) {
          sessionReply(connection, sequence, statements, null, "The JDBC provider could not complete the database operation.", error.getSQLState());
        }
      }
    } finally {
      if (!connection.isClosed() && !connection.getAutoCommit()) {
        try { connection.rollback(); } catch (SQLException ignored) { }
      }
    }
  }

  private static String readField(BufferedReader input) throws Exception {
    String line = input.readLine();
    if (line == null || line.length() > 2_000_000) throw new IllegalArgumentException();
    return new String(Base64.getDecoder().decode(line), StandardCharsets.UTF_8);
  }

  private static final class Parameter {
    final String type, value;
    Parameter(String type, String value) { this.type = type; this.value = value; }
  }
  private static final class ParameterException extends Exception {
    ParameterException(String message) { super(message); }
  }
  private static List<Parameter> readParameters(BufferedReader input) throws Exception {
    String line = input.readLine();
    if (line == null || line.length() > 4) throw new IllegalArgumentException();
    int count = Integer.parseInt(line);
    if (count == -1) return null;
    if (count < 0 || count > 256) throw new IllegalArgumentException();
    List<Parameter> result = new ArrayList<Parameter>();
    int total = 0;
    for (int index = 0; index < count; index++) {
      String type = readField(input), value = readField(input);
      total += value.getBytes(StandardCharsets.UTF_8).length;
      if (type.length() > 16 || value.getBytes(StandardCharsets.UTF_8).length > 16*1024 || total > 64*1024 || value.indexOf(0) >= 0) throw new IllegalArgumentException();
      result.add(new Parameter(type, value));
    }
    return result;
  }
  private static void bind(PreparedStatement statement, List<Parameter> parameters) throws Exception {
    try {
      int count = statement.getParameterMetaData().getParameterCount();
      if (count != parameters.size()) throw new ParameterException("The SQL statement expects " + count + " parameters, but " + parameters.size() + " were supplied.");
    } catch (SQLFeatureNotSupportedException ignored) {
      // The driver still owns binding and execution validation when metadata is unsupported.
    } catch (AbstractMethodError ignored) { }
    for (int index = 0; index < parameters.size(); index++) {
      Parameter parameter = parameters.get(index);
      int position = index+1;
      try {
        switch (parameter.type) {
          case "string": statement.setString(position, parameter.value); break;
          case "integer": statement.setLong(position, Long.parseLong(parameter.value)); break;
          case "decimal":
            BigDecimal decimal = new BigDecimal(parameter.value);
            if (decimal.precision() > 1024 || Math.abs((long)decimal.scale()) > 1024) throw new IllegalArgumentException();
            statement.setBigDecimal(position, decimal); break;
          case "boolean":
            if (!parameter.value.equals("true") && !parameter.value.equals("false")) throw new IllegalArgumentException();
            statement.setBoolean(position, Boolean.parseBoolean(parameter.value)); break;
          case "null":
            if (!parameter.value.isEmpty()) throw new IllegalArgumentException();
            statement.setNull(position, Types.NULL); break;
          case "date": statement.setDate(position, java.sql.Date.valueOf(LocalDate.parse(parameter.value))); break;
          case "time": statement.setObject(position, LocalTime.parse(parameter.value), Types.TIME); break;
          case "timestamp": statement.setTimestamp(position, java.sql.Timestamp.valueOf(LocalDateTime.parse(parameter.value))); break;
          case "binary": statement.setBytes(position, Base64.getDecoder().decode(parameter.value)); break;
          default: throw new IllegalArgumentException();
        }
      } catch (IllegalArgumentException | java.time.DateTimeException error) {
        throw new ParameterException("SQL parameter " + position + " has an invalid value for its selected type.");
      }
    }
  }

  private static String inspect(DatabaseMetaData metadata) throws Exception {
    StringBuilder output = new StringBuilder("{\"productName\":");
    appendString(output, limited(metadata.getDatabaseProductName(), 256));
    output.append(",\"productVersion\":");
    appendString(output, limited(metadata.getDatabaseProductVersion(), 256));
    String quote = null;
    String catalog = null;
    try {
      String value = metadata.getIdentifierQuoteString();
      if (value != null && !value.trim().isEmpty() && value.length() <= 16) quote = value;
    } catch (java.sql.SQLException | AbstractMethodError | UnsupportedOperationException unavailable) { /* Optional metadata. */ }
    try {
      Connection owner = metadata.getConnection();
      String value = owner == null ? null : owner.getCatalog();
      if (value != null && !value.isEmpty() && value.length() < 256) catalog = value;
    } catch (java.sql.SQLException | AbstractMethodError | UnsupportedOperationException unavailable) { /* Optional metadata. */ }
    output.append(",\"identifierQuoteString\":");
    appendNullableString(output, quote);
    output.append(",\"currentCatalog\":");
    appendNullableString(output, catalog);
    output.append(",\"estimatedPlanDialect\":");
    appendNullableString(output, estimatedPlanDialect(metadata));
    output.append(",\"tables\":[");
    boolean truncated = false;
    int tableCount = 0;
    try (ResultSet tables = metadata.getTables(null, null, "%", new String[] {"TABLE", "VIEW"})) {
      while (tables.next()) {
        String schema = tables.getString("TABLE_SCHEM");
        String name = tables.getString("TABLE_NAME");
        String type = tables.getString("TABLE_TYPE");
        if (name == null || isSystemSchema(schema)) continue;
        if (tableCount >= MAX_TABLES || output.length() >= MAX_RESULT_CHARS) {
          truncated = true;
          break;
        }
        if (tableCount > 0) output.append(',');
        output.append("{\"catalog\":");
        appendNullableString(output, limited(tables.getString("TABLE_CAT"), MAX_NAME_CHARS));
        output.append(",\"schema\":");
        appendNullableString(output, limited(schema, MAX_NAME_CHARS));
        output.append(",\"name\":");
        appendString(output, limited(name, MAX_NAME_CHARS));
        output.append(",\"tableType\":");
        appendString(output, limited(type == null ? "TABLE" : type, 64));
        output.append(",\"columns\":[");
        boolean columnsTruncated = false;
        int columnCount = 0;
        try (ResultSet columns = metadata.getColumns(
            tables.getString("TABLE_CAT"), schema, name, "%")) {
          while (columns.next()) {
            String columnName = columns.getString("COLUMN_NAME");
            String typeName = columns.getString("TYPE_NAME");
            if (columnCount >= MAX_COLUMNS || output.length() >= MAX_RESULT_CHARS) {
              columnsTruncated = true;
              truncated = true;
              break;
            }
            if (columnCount > 0) output.append(',');
            output.append("{\"name\":");
            appendString(output, limited(columnName, MAX_NAME_CHARS));
            output.append(",\"typeName\":");
            appendString(output, limited(typeName, 128));
            output.append(",\"nullable\":");
            output.append(columns.getInt("NULLABLE") != DatabaseMetaData.columnNoNulls);
            output.append('}');
            columnCount++;
          }
        }
        output.append("],\"columnsTruncated\":").append(columnsTruncated).append('}');
        tableCount++;
      }
    }
    output.append("],\"truncated\":").append(truncated).append('}');
    if (output.length() > MAX_RESULT_CHARS + 16_384) throw new IllegalStateException();
    return output.toString();
  }

  private static String estimatedPlanDialect(DatabaseMetaData metadata) throws SQLException {
    return "H2".equals(metadata.getDatabaseProductName()) && metadata.getDatabaseMajorVersion() == 2 ? "h2" : null;
  }

  /** Admission fence for one H2 statement, not a SQL parser or semantic model. */
  private static void requireSingleH2Statement(String sql) throws ParameterException {
    boolean terminated = false;
    String first = null;
    for (int i = 0; i < sql.length();) {
      char c = sql.charAt(i);
      char next = i + 1 < sql.length() ? sql.charAt(i + 1) : 0;
      if (Character.isWhitespace(c)) { i++; continue; }
      if ((c == '-' && next == '-') || (c == '/' && next == '/')) {
        i += 2;
        while (i < sql.length() && sql.charAt(i) != '\n' && sql.charAt(i) != '\r') i++;
        continue;
      }
      if (c == '/' && next == '*') {
        int depth = 1; i += 2;
        while (i < sql.length() && depth > 0) {
          if (i + 1 < sql.length() && sql.charAt(i) == '/' && sql.charAt(i+1) == '*') { depth++; i += 2; }
          else if (i + 1 < sql.length() && sql.charAt(i) == '*' && sql.charAt(i+1) == '/') { depth--; i += 2; }
          else i++;
        }
        if (depth != 0) throw new ParameterException("Close the SQL comment before estimating a plan.");
        continue;
      }
      if (terminated) throw new ParameterException("Estimate one SQL statement at a time.");
      if (first == null) {
        int start = i;
        while (i < sql.length() && ((sql.charAt(i) >= 'a' && sql.charAt(i) <= 'z') || (sql.charAt(i) >= 'A' && sql.charAt(i) <= 'Z'))) i++;
        first = sql.substring(start, i).toUpperCase(java.util.Locale.ROOT);
        if (!java.util.Arrays.asList("SELECT", "WITH", "TABLE", "VALUES", "INSERT", "UPDATE", "DELETE", "MERGE").contains(first))
          throw new ParameterException("Estimate a query or INSERT, UPDATE, DELETE or MERGE statement; do not include EXPLAIN or ANALYZE.");
        continue;
      }
      if (c == ';') { terminated = true; i++; continue; }
      if (c == '\'' || c == '"' || c == '`') {
        char quote = c; boolean closed = false; i++;
        while (i < sql.length()) {
          if (sql.charAt(i++) == quote) {
            if (i < sql.length() && sql.charAt(i) == quote) { i++; continue; }
            closed = true; break;
          }
        }
        if (!closed) throw new ParameterException("Close the SQL string or identifier before estimating a plan.");
        continue;
      }
      if (c == '$' && next == '$') {
        // H2 identifiers can contain dollar signs. Requiring the documented
        // preceding whitespace prevents treating an identifier suffix as a string.
        if (i == 0 || !Character.isWhitespace(sql.charAt(i-1)))
          throw new ParameterException("Separate dollar-quoted strings from preceding tokens with whitespace.");
        int end = sql.indexOf("$$", i+2);
        if (end < 0) throw new ParameterException("Close the dollar-quoted SQL string before estimating a plan.");
        i = end+2; continue;
      }
      i++;
    }
    if (first == null) throw new ParameterException("Enter one SQL statement to estimate its plan.");
  }

  private static String explain(Connection connection, String sql, List<Parameter> parameters) throws Exception {
    if (!"h2".equals(estimatedPlanDialect(connection.getMetaData())))
      throw new ParameterException("Estimated query plans are unavailable for this JDBC provider.");
    // Compatibility modes have different lexical rules. Recheck the live mode on
    // every request because the SQL console can change it after schema inspection.
    try (Statement statement = connection.createStatement()) {
      statement.setQueryTimeout(25);
      try (ResultSet result = statement.executeQuery("SELECT SETTING_VALUE FROM INFORMATION_SCHEMA.SETTINGS WHERE SETTING_NAME = 'MODE'")) {
        if (!result.next() || !"REGULAR".equals(result.getString(1)))
          throw new ParameterException("Estimated query plans currently require H2 REGULAR mode.");
      }
    }
    requireSingleH2Statement(sql);
    // PLAN FOR fixes the grammar to the estimated form. User SQL cannot promote
    // this operation to EXPLAIN ANALYZE. Typed parameters still use JDBC binding.
    return "{\"planDialect\":\"h2\",\"query\":" + execute(connection, "EXPLAIN PLAN FOR " + sql, parameters) + "}";
  }

  private static String execute(Connection connection, String sql, List<Parameter> parameters) throws Exception {
    if (sql.trim().isEmpty()) throw new IllegalArgumentException();
    try (Statement statement = parameters == null ? connection.createStatement() : connection.prepareStatement(sql)) {
      if (parameters != null) bind((PreparedStatement)statement, parameters);
      statement.setQueryTimeout(25);
      statement.setMaxRows(MAX_ROWS + 1);
      boolean hasResult = parameters == null ? statement.execute(sql) : ((PreparedStatement)statement).execute();
      if (!hasResult) {
        int updateCount = statement.getUpdateCount();
        return "{\"columns\":[],\"rows\":[],\"updateCount\":" +
            (updateCount < 0 ? "null" : Integer.toString(updateCount)) +
            ",\"rowsTruncated\":false}";
      }
      try (ResultSet result = statement.getResultSet()) {
        ResultSetMetaData metadata = result.getMetaData();
        int count = metadata.getColumnCount();
        if (count > MAX_COLUMNS) throw new IllegalArgumentException();
        List<String> labels = new ArrayList<String>();
        List<String> types = new ArrayList<String>();
        for (int index = 1; index <= count; index++) {
          String label = metadata.getColumnLabel(index);
          if (label == null || label.isEmpty()) label = metadata.getColumnName(index);
          labels.add(limited(label, MAX_NAME_CHARS));
          types.add(limited(metadata.getColumnTypeName(index), 128));
        }
        List<List<String>> rows = new ArrayList<List<String>>();
        int resultChars = 0;
        boolean truncated = false;
        while (result.next()) {
          if (rows.size() >= MAX_ROWS) {
            truncated = true;
            break;
          }
          List<String> row = new ArrayList<String>();
          int rowChars = 0;
          for (int index = 1; index <= count; index++) {
            String value = displayValue(result.getObject(index));
            rowChars += value == null ? 4 : value.length();
            if (resultChars + rowChars > MAX_RESULT_CHARS) {
              truncated = true;
              break;
            }
            row.add(value);
          }
          if (truncated && row.size() != count) break;
          rows.add(row);
          resultChars += rowChars;
        }
        if (!truncated && rows.size() == MAX_ROWS && result.next()) truncated = true;
        return queryJson(labels, types, rows, truncated);
      }
    }
  }

  private static String queryJson(
      List<String> labels, List<String> types, List<List<String>> rows, boolean truncated) {
    StringBuilder output = new StringBuilder("{\"columns\":[");
    for (int index = 0; index < labels.size(); index++) {
      if (index > 0) output.append(',');
      output.append("{\"name\":");
      appendString(output, labels.get(index));
      output.append(",\"typeName\":");
      appendString(output, types.get(index));
      output.append('}');
    }
    output.append("],\"rows\":[");
    for (int rowIndex = 0; rowIndex < rows.size(); rowIndex++) {
      if (rowIndex > 0) output.append(',');
      output.append('[');
      List<String> row = rows.get(rowIndex);
      for (int column = 0; column < row.size(); column++) {
        if (column > 0) output.append(',');
        appendNullableString(output, row.get(column));
      }
      output.append(']');
    }
    return output.append("],\"updateCount\":null,\"rowsTruncated\":")
        .append(truncated).append('}').toString();
  }

  private static String displayValue(Object value) throws Exception {
    if (value == null) return null;
    if (value instanceof Blob) return "[BLOB " + ((Blob) value).length() + " bytes]";
    if (value instanceof Clob) {
      Clob clob = (Clob) value;
      long length = clob.length();
      int readLength = (int) Math.min(length, MAX_CELL_CHARS);
      String text = clob.getSubString(1, readLength);
      return limited(text + (length > readLength ? "…" : ""), MAX_CELL_CHARS);
    }
    if (value instanceof byte[]) return "[BINARY " + ((byte[]) value).length + " bytes]";
    return limited(String.valueOf(value), MAX_CELL_CHARS);
  }

  private static boolean isSystemSchema(String schema) {
    if (schema == null) return false;
    String normalized = schema.toLowerCase();
    return normalized.equals("information_schema") || normalized.equals("pg_catalog") ||
        normalized.equals("sys") || normalized.equals("system") || normalized.equals("dbo_system");
  }

  private static String limited(String value, int maximum) {
    if (value == null) return "";
    return value.length() <= maximum ? value : value.substring(0, maximum);
  }

  private static void appendNullableString(StringBuilder output, String value) {
    if (value == null) output.append("null");
    else appendString(output, value);
  }

  private static void appendString(StringBuilder output, String value) {
    output.append('"');
    for (int index = 0; index < value.length(); index++) {
      char character = value.charAt(index);
      if (character == '"' || character == '\\') output.append('\\').append(character);
      else if (character < 0x20) output.append(String.format("\\u%04x", (int) character));
      else output.append(character);
    }
    output.append('"');
  }

  private static String json(String value) {
    StringBuilder output = new StringBuilder();
    appendString(output, value);
    return output.toString().substring(1, output.length() - 1);
  }
}
