/** Real Spring MVC/JDBC reference project. No IDE/provider responses are fabricated. */
export const javaReferenceBackend: Readonly<Record<string, string>> = {
  "pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>4.1.2</version><relativePath/></parent>
  <groupId>reference</groupId><artifactId>backend</artifactId><version>1.0</version>
  <properties><java.version>17</java.version></properties>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-webmvc</artifactId></dependency>
    <dependency><groupId>com.h2database</groupId><artifactId>h2</artifactId><version>2.4.240</version></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
  </dependencies>
</project>
`,
  "src/main/resources/application.properties": `server.address=127.0.0.1
server.port=0
spring.main.banner-mode=off
reference.nonce=fixture-reference-backend
reference.database=fixture_reference_backend
`,
  "src/main/java/reference/backend/ReferenceApplication.java": `package reference.backend;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import org.h2.tools.Server;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.annotation.Bean;
@SpringBootApplication
public class ReferenceApplication {
  @Bean(destroyMethod = "stop")
  Server databaseServer() throws java.sql.SQLException {
    System.setProperty("h2.bindAddress", "127.0.0.1");
    return Server.createTcpServer("-tcpPort", "0", "-tcpDaemon").start();
  }
  public static void main(String[] args) throws Exception {
    var context = (WebServerApplicationContext) SpringApplication.run(ReferenceApplication.class, args);
    var values = new Properties();
    values.setProperty("pid", Long.toString(ProcessHandle.current().pid()));
    values.setProperty("httpPort", Integer.toString(context.getWebServer().getPort()));
    values.setProperty("jdbcPort", Integer.toString(context.getBean(Server.class).getPort()));
    values.setProperty("nonce", context.getEnvironment().getRequiredProperty("reference.nonce"));
    values.setProperty("database", context.getEnvironment().getRequiredProperty("reference.database"));
    Path output = Path.of("target/reference-runtime.properties");
    Files.createDirectories(output.getParent());
    try (var stream = Files.newOutputStream(output)) { values.store(stream, "Owned reference backend runtime"); }
    System.out.println("REFERENCE_BACKEND_READY");
  }
}
`,
  "src/main/java/reference/backend/GreetingStore.java": `package reference.backend;
import java.sql.DriverManager;
import java.sql.SQLException;
import org.h2.tools.Server;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;
@Repository
public class GreetingStore {
  private final String url;
  public GreetingStore(Server server, @Value("\${reference.database}") String database) throws SQLException {
    url = "jdbc:h2:mem:" + database + ";DB_CLOSE_DELAY=-1";
    try (var connection = DriverManager.getConnection(url, "sa", ""); var statement = connection.createStatement()) {
      statement.execute("CREATE TABLE GREETING(ID INTEGER PRIMARY KEY, NAME VARCHAR(200) NOT NULL)");
      statement.executeUpdate("INSERT INTO GREETING VALUES(1, 'Java')");
    }
  }
  public String find(int id) throws SQLException {
    try (var connection = DriverManager.getConnection(url, "sa", ""); var statement = connection.prepareStatement("SELECT NAME FROM GREETING WHERE ID=?")) {
      statement.setInt(1, id);
      try (var rows = statement.executeQuery()) { return rows.next() ? rows.getString(1) : "missing"; }
    }
  }
}
`,
  "src/main/java/reference/backend/GreetingFormatter.java": `package reference.backend;
public final class GreetingFormatter {
  private GreetingFormatter() {}
  public static String render(String name) { return "Hello, " + name; }
}
`,
  "src/main/java/reference/backend/GreetingController.java": `package reference.backend;
import java.sql.SQLException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
@RestController
public class GreetingController {
  private final GreetingStore store;
  private final String nonce;
  public GreetingController(GreetingStore store, @Value("\${reference.nonce}") String nonce) { this.store = store; this.nonce = nonce; }
  @GetMapping("/api/greetings/{id}")
  public ResponseEntity<String> greeting(@PathVariable int id) throws SQLException {
    String name = store.find(id);
    return ResponseEntity.ok().header("X-Reference-Nonce", nonce).body(GreetingFormatter.render(name));
  }
}
`,
  "src/test/java/reference/backend/GreetingFormatterTest.java": `package reference.backend;
import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;
class GreetingFormatterTest {
  @Test void formatsTheGreeting() { assertEquals("Hello, Java", GreetingFormatter.render("Java")); }
}
`,
  "src/test/java/reference/backend/ReferenceApplicationTest.java": `package reference.backend;
import static org.junit.jupiter.api.Assertions.assertEquals;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ReferenceApplicationTest {
  @Autowired WebServerApplicationContext context;
  @Test void servesRealDatabaseStateOverHttp() throws Exception {
    var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + context.getWebServer().getPort() + "/api/greetings/1")).GET().build();
    var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
    assertEquals(200, response.statusCode());
    assertEquals("Hello, Java", response.body());
    assertEquals(context.getEnvironment().getRequiredProperty("reference.nonce"), response.headers().firstValue("X-Reference-Nonce").orElseThrow());
    System.out.println("REFERENCE_BACKEND_HTTP_TEST_OK");
  }
}
`,
};
