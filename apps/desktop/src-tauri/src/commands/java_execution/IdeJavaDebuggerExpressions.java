/** A bounded interpreter for read-only JDI values; it never executes debuggee code. */
final class IdeJavaDebuggerExpressions {
    interface Resolver {
        Object value(String path) throws Exception;
        default Object arrayIndex(Object value, int index) throws Exception {
            if (!(value instanceof ArrayReference array))
                throw new IllegalArgumentException("Array indexing requires an array value.");
            return mirror(array.getValue(index));
        }
        default Object memberPath(Object value, String path) throws Exception {
            throw new IllegalArgumentException("Object member reads are unavailable.");
        }
        default boolean instanceOf(Object value, String typeName) throws Exception {
            throw new IllegalArgumentException("Runtime type tests are unavailable.");
        }
    }
    interface Expression { Object evaluate(Resolver resolver) throws Exception; }
    private enum TokenKind { NUMBER, PATH, STRING, CHARACTER, SYMBOL }
    private record Token(String text, TokenKind kind) {
        boolean number() { return kind == TokenKind.NUMBER; }
        boolean path() { return kind == TokenKind.PATH; }
        boolean symbol(String value) { return kind == TokenKind.SYMBOL && text.equals(value); }
    }
    record ExpressionString(String value, StringReference reference, boolean literal) { }
    record ExpressionCharacter(char value) { }
    record ExpressionWrapper(ObjectReference reference, long identity, String typeName, Object value) { }
    private static final Pattern NUMBER = Pattern.compile("(?:"
        + "0[xX](?:[0-9a-fA-F_]+(?:\\.[0-9a-fA-F_]*)?|\\.[0-9a-fA-F_]+)[pP][+-]?[0-9][0-9_]*[fFdD]?"
        + "|0[xX][0-9a-fA-F_]+[lL]?"
        + "|0[bB][01_]+[lL]?"
        + "|(?:[0-9][0-9_]*\\.(?:[0-9][0-9_]*)?|\\.[0-9][0-9_]*|[0-9][0-9_]*)(?:[eE][+-]?[0-9][0-9_]*)?[fFdDlL]?"
        + ")");
    private static final Pattern PATH = Pattern.compile("[\\p{javaJavaIdentifierStart}][\\p{javaJavaIdentifierPart}]*(?:\\.[\\p{javaJavaIdentifierStart}][\\p{javaJavaIdentifierPart}]*|\\[[0-9]+\\])*");

    static Expression compile(String text) {
        if (text.getBytes(StandardCharsets.UTF_8).length > 512 || text.indexOf('\0') >= 0 || text.indexOf('\n') >= 0 || text.indexOf('\r') >= 0)
            throw new IllegalArgumentException("Debugger expressions are limited to 512 UTF-8 bytes on one line.");
        if (text.isBlank()) return resolver -> Boolean.TRUE;
        Parser parser = new Parser(text);
        Expression result = parser.expression(1, 0);
        if (parser.peek() != null) throw new IllegalArgumentException("Unsupported expression syntax. Method calls and assignments are unavailable.");
        return result;
    }

    static Object mirror(Value value) throws Exception {
        if (value == null) return null;
        if (value instanceof StringReference string) return new ExpressionString(string.value(), string, false);
        if (value instanceof CharValue character) return new ExpressionCharacter(character.value());
        if (value instanceof ObjectReference object) {
            ExpressionWrapper wrapper = mirrorWrapper(object);
            return wrapper == null ? object : wrapper;
        }
        if (value instanceof BooleanValue v) return v.value();
        if (value instanceof ByteValue v) return v.value();
        if (value instanceof ShortValue v) return v.value();
        if (value instanceof IntegerValue v) return v.value();
        if (value instanceof LongValue v) return v.value();
        if (value instanceof FloatValue v) return v.value();
        if (value instanceof DoubleValue v) return v.value();
        throw new IllegalArgumentException("The condition value is not a supported runtime value.");
    }

    private static String wrapperPrimitiveType(String typeName) {
        return switch (typeName) {
            case "java.lang.Boolean" -> "boolean";
            case "java.lang.Byte" -> "byte";
            case "java.lang.Character" -> "char";
            case "java.lang.Short" -> "short";
            case "java.lang.Integer" -> "int";
            case "java.lang.Long" -> "long";
            case "java.lang.Float" -> "float";
            case "java.lang.Double" -> "double";
            default -> null;
        };
    }

    private static ExpressionWrapper mirrorWrapper(ObjectReference object) throws Exception {
        ReferenceType type = object.referenceType();
        String primitiveType = wrapperPrimitiveType(type.name());
        if (primitiveType == null || type.classLoader() != null) return null;
        Field valueField = type.fieldByName("value");
        if (valueField == null || valueField.isStatic() || !valueField.isPrivate()
            || !valueField.isFinal() || !valueField.typeName().equals(primitiveType)) return null;
        Object value = mirror(object.getValue(valueField));
        return new ExpressionWrapper(object, object.uniqueID(), type.name(), value);
    }

    private static Object unbox(Object value) {
        return value instanceof ExpressionWrapper wrapper ? wrapper.value() : value;
    }

    private static boolean primitiveValue(Object value) {
        return value instanceof Number || value instanceof Boolean || value instanceof ExpressionCharacter;
    }

    private static Long referenceIdentity(Object value) {
        if (value instanceof ExpressionWrapper wrapper) return wrapper.identity();
        if (value instanceof ObjectReference reference) return reference.uniqueID();
        if (value instanceof ExpressionString string && string.reference() != null)
            return string.reference().uniqueID();
        return null;
    }

    static boolean truth(Object value) {
        value = unbox(value);
        if (value instanceof Boolean result) return result;
        throw new IllegalArgumentException("A breakpoint condition must evaluate to a boolean.");
    }
    private static Number numeric(Object value) {
        value = unbox(value);
        if (value instanceof Number result) return result;
        if (value instanceof ExpressionCharacter character) return (int) character.value();
        throw new IllegalArgumentException("This expression operator requires primitive numeric values.");
    }
    private static Object unary(String operator, Object value) {
        if (operator.equals("!")) return !truth(value);
        Number number = numeric(value);
        if (operator.equals("~")) {
            if (number instanceof Long) return ~number.longValue();
            if (number instanceof Byte || number instanceof Short || number instanceof Integer) return ~number.intValue();
            throw new IllegalArgumentException("Bitwise complement requires an int or long value.");
        }
        if (operator.equals("+")) {
            if (number instanceof Byte || number instanceof Short) return Integer.valueOf(number.intValue());
            return number;
        }
        if (number instanceof Double) return -number.doubleValue();
        if (number instanceof Float) return -number.floatValue();
        if (number instanceof Long) return -number.longValue();
        return -number.intValue();
    }
    private static Object binary(String operator, Object left, Object right) {
        if (operator.equals("==") || operator.equals("!=")) {
            boolean equal;
            if (left instanceof ExpressionString first && right instanceof ExpressionString second) {
                if (first.reference() != null && second.reference() != null)
                    equal = first.reference().uniqueID() == second.reference().uniqueID();
                else if (first.literal() && second.literal()) equal = first.value().equals(second.value());
                else throw new IllegalArgumentException("String reference identity cannot be established for computed values.");
            }
            else if (left == null || right == null) equal = left == right;
            else if (left instanceof ExpressionWrapper first && right instanceof ExpressionWrapper second)
                equal = first.identity() == second.identity();
            else if (left instanceof ExpressionWrapper && primitiveValue(right)
                || right instanceof ExpressionWrapper && primitiveValue(left)) {
                Object first = unbox(left), second = unbox(right);
                if (first instanceof Boolean && second instanceof Boolean) equal = first.equals(second);
                else if (primitiveValue(first) && primitiveValue(second)
                    && !(first instanceof Boolean) && !(second instanceof Boolean))
                    equal = compare("==", numeric(first), numeric(second));
                else throw new IllegalArgumentException("Incompatible condition equality operands.");
            }
            else if (referenceIdentity(left) != null && referenceIdentity(right) != null)
                equal = referenceIdentity(left).longValue() == referenceIdentity(right).longValue();
            else if (left instanceof Number && right instanceof Number || left instanceof ExpressionCharacter && right instanceof ExpressionCharacter || left instanceof ExpressionCharacter && right instanceof Number || left instanceof Number && right instanceof ExpressionCharacter)
                equal = compare("==", numeric(left), numeric(right));
            else if (left instanceof Boolean && right instanceof Boolean) equal = left.equals(right);
            else if (left instanceof ObjectReference first && right instanceof ObjectReference second)
                equal = first.uniqueID() == second.uniqueID();
            else throw new IllegalArgumentException("Incompatible condition equality operands; reference unboxing is unavailable.");
            return operator.equals("==") ? equal : !equal;
        }
        if (Set.of("&", "|", "^").contains(operator)) return bitwise(operator, left, right);
        if (Set.of("<<", ">>", ">>>").contains(operator)) return shift(operator, left, right);
        if (operator.equals("+") && (left instanceof ExpressionString || right instanceof ExpressionString))
            return new ExpressionString(stringValue(left) + stringValue(right), null, false);
        Number a = numeric(left), b = numeric(right);
        if (Set.of("<", "<=", ">", ">=").contains(operator)) return compare(operator, a, b);
        if (a instanceof Double || b instanceof Double) {
            double x = a.doubleValue(), y = b.doubleValue();
            return switch (operator) { case "+" -> x + y; case "-" -> x - y; case "*" -> x * y; case "/" -> x / y; case "%" -> x % y; default -> throw new IllegalArgumentException("Unsupported numeric operator."); };
        }
        if (a instanceof Float || b instanceof Float) {
            float x = a.floatValue(), y = b.floatValue();
            return switch (operator) { case "+" -> x + y; case "-" -> x - y; case "*" -> x * y; case "/" -> x / y; case "%" -> x % y; default -> throw new IllegalArgumentException("Unsupported numeric operator."); };
        }
        if (a instanceof Long || b instanceof Long) {
            long x = a.longValue(), y = b.longValue();
            return switch (operator) { case "+" -> x + y; case "-" -> x - y; case "*" -> x * y; case "/" -> x / y; case "%" -> x % y; default -> throw new IllegalArgumentException("Unsupported numeric operator."); };
        }
        int x = a.intValue(), y = b.intValue();
        return switch (operator) { case "+" -> x + y; case "-" -> x - y; case "*" -> x * y; case "/" -> x / y; case "%" -> x % y; default -> throw new IllegalArgumentException("Unsupported numeric operator."); };
    }
    private static Object bitwise(String operator, Object left, Object right) {
        left = unbox(left);
        right = unbox(right);
        if (left instanceof Boolean first && right instanceof Boolean second) {
            return switch (operator) {
                case "&" -> first & second;
                case "|" -> first | second;
                case "^" -> first ^ second;
                default -> throw new IllegalArgumentException("Unsupported boolean operator.");
            };
        }
        Number first = numeric(left), second = numeric(right);
        if (first instanceof Long || second instanceof Long) {
            long a = integralLong(first), b = integralLong(second);
            return switch (operator) {
                case "&" -> a & b;
                case "|" -> a | b;
                case "^" -> a ^ b;
                default -> throw new IllegalArgumentException("Unsupported bitwise operator.");
            };
        }
        int a = integralInt(first), b = integralInt(second);
        return switch (operator) {
            case "&" -> a & b;
            case "|" -> a | b;
            case "^" -> a ^ b;
            default -> throw new IllegalArgumentException("Unsupported bitwise operator.");
        };
    }
    private static Object shift(String operator, Object left, Object right) {
        Number value = numeric(left), distance = numeric(right);
        int shift = integralInt(distance);
        if (value instanceof Long) {
            long number = value.longValue();
            int masked = shift & 0x3f;
            return switch (operator) {
                case "<<" -> number << masked;
                case ">>" -> number >> masked;
                case ">>>" -> number >>> masked;
                default -> throw new IllegalArgumentException("Unsupported shift operator.");
            };
        }
        int number = integralInt(value);
        int masked = shift & 0x1f;
        return switch (operator) {
            case "<<" -> number << masked;
            case ">>" -> number >> masked;
            case ">>>" -> number >>> masked;
            default -> throw new IllegalArgumentException("Unsupported shift operator.");
        };
    }
    private static int integralInt(Number value) {
        if (value instanceof Byte || value instanceof Short || value instanceof Integer) return value.intValue();
        if (value instanceof Long) return value.intValue();
        throw new IllegalArgumentException("Bitwise and shift operators require int or long values.");
    }
    private static long integralLong(Number value) {
        if (value instanceof Byte || value instanceof Short || value instanceof Integer || value instanceof Long) return value.longValue();
        throw new IllegalArgumentException("Bitwise operators require int or long values.");
    }
    private static boolean supportedStringMethod(String method, int arguments) {
        return switch (method) {
            case "length", "isEmpty" -> arguments == 0;
            case "charAt", "contains", "equals", "equalsIgnoreCase", "endsWith" -> arguments == 1;
            case "indexOf", "lastIndexOf", "substring" -> arguments == 1 || arguments == 2;
            case "startsWith" -> arguments == 1 || arguments == 2;
            default -> false;
        };
    }
    private static String stringArgument(Object value) {
        if (value instanceof ExpressionString string) return string.value();
        throw new IllegalArgumentException("This String operation requires a String value.");
    }
    private static int integerArgument(Object value) {
        value = unbox(value);
        if (value instanceof Integer integer) return integer;
        if (value instanceof Byte number) return number.intValue();
        if (value instanceof Short number) return number.intValue();
        if (value instanceof ExpressionCharacter character) return character.value();
        throw new IllegalArgumentException("This String operation requires an int value.");
    }
    private static int arrayIndex(Object value) {
        value = unbox(value);
        if (value instanceof Integer integer) return integer;
        if (value instanceof Byte number) return number.intValue();
        if (value instanceof Short number) return number.intValue();
        if (value instanceof ExpressionCharacter character) return character.value();
        throw new IllegalArgumentException("An array index must evaluate to an int value.");
    }
    private static Object castPrimitive(String target, Object value) {
        value = unbox(value);
        if (target.equals("boolean")) {
            if (value instanceof Boolean) return value;
            throw new IllegalArgumentException("A boolean cast requires a boolean value.");
        }
        Number number = numeric(value);
        return switch (target) {
            case "byte" -> Byte.valueOf((byte) number.intValue());
            case "short" -> Short.valueOf((short) number.intValue());
            case "char" -> new ExpressionCharacter((char) number.intValue());
            case "int" -> Integer.valueOf(number.intValue());
            case "long" -> Long.valueOf(number.longValue());
            case "float" -> Float.valueOf(number.floatValue());
            case "double" -> Double.valueOf(number.doubleValue());
            default -> throw new IllegalArgumentException("Unsupported primitive cast.");
        };
    }
    static Object primitiveAssignment(String target, Object evaluated) {
        Object value = unbox(evaluated);
        if (value == null)
            throw new IllegalArgumentException("A primitive local cannot receive null.");
        boolean smallerThanInt =
            value instanceof Byte || value instanceof Short || value instanceof ExpressionCharacter;
        boolean compatible = switch (target) {
            case "boolean" -> value instanceof Boolean;
            case "byte" -> value instanceof Byte;
            case "short" -> value instanceof Byte || value instanceof Short;
            case "char" -> value instanceof ExpressionCharacter;
            case "int" -> smallerThanInt || value instanceof Integer;
            case "long" -> smallerThanInt || value instanceof Integer || value instanceof Long;
            case "float" -> smallerThanInt || value instanceof Integer || value instanceof Long
                || value instanceof Float;
            case "double" -> smallerThanInt || value instanceof Integer || value instanceof Long
                || value instanceof Float || value instanceof Double;
            default -> false;
        };
        if (!compatible)
            throw new IllegalArgumentException(
                "Incompatible primitive assignment to local type `" + target + "`. Use an explicit cast for narrowing."
            );
        return castPrimitive(target, value);
    }
    private static Object stringMethod(Object receiver, String method, List<Object> arguments) {
        if (!(receiver instanceof ExpressionString string))
            throw new IllegalArgumentException("Selected read-only String operations require a String receiver.");
        String value = string.value();
        return switch (method) {
            case "length" -> value.length();
            case "isEmpty" -> value.isEmpty();
            case "charAt" -> new ExpressionCharacter(value.charAt(integerArgument(arguments.get(0))));
            case "substring" -> new ExpressionString(
                arguments.size() == 1
                    ? value.substring(integerArgument(arguments.get(0)))
                    : value.substring(integerArgument(arguments.get(0)), integerArgument(arguments.get(1))),
                null,
                false
            );
            case "equals" -> arguments.get(0) instanceof ExpressionString other && value.equals(other.value());
            case "equalsIgnoreCase" -> arguments.get(0) instanceof ExpressionString other && value.equalsIgnoreCase(other.value());
            case "contains" -> value.contains(stringArgument(arguments.get(0)));
            case "indexOf" -> stringSearch(value, arguments, false);
            case "lastIndexOf" -> stringSearch(value, arguments, true);
            case "startsWith" -> arguments.size() == 1
                ? value.startsWith(stringArgument(arguments.get(0)))
                : value.startsWith(stringArgument(arguments.get(0)), integerArgument(arguments.get(1)));
            case "endsWith" -> value.endsWith(stringArgument(arguments.get(0)));
            default -> throw new IllegalArgumentException("Method calls and assignments are unavailable.");
        };
    }
    private static int stringSearch(String value, List<Object> arguments, boolean last) {
        Object target = unbox(arguments.get(0));
        boolean fromIndexProvided = arguments.size() == 2;
        int fromIndex = fromIndexProvided ? integerArgument(arguments.get(1)) : last ? value.length() : 0;
        if (target instanceof ExpressionString string) {
            if (last) return value.lastIndexOf(string.value(), fromIndex);
            return value.indexOf(string.value(), fromIndex);
        }
        if (target instanceof Number || target instanceof ExpressionCharacter) {
            int codePoint = integerArgument(target);
            if (last) return value.lastIndexOf(codePoint, fromIndex);
            return value.indexOf(codePoint, fromIndex);
        }
        throw new IllegalArgumentException("String search requires a string or character-code value.");
    }
    private static String stringValue(Object value) {
        value = unbox(value);
        if (value == null) return "null";
        if (value instanceof ExpressionString string) return string.value();
        if (value instanceof ExpressionCharacter character) return String.valueOf(character.value());
        if (value instanceof Boolean || value instanceof Number) return String.valueOf(value);
        throw new IllegalArgumentException("String conversion of application objects is unavailable because it could execute application code.");
    }
    private static boolean compare(String op, Number a, Number b) {
        // Binary numeric promotion follows the Java primitive categories; long equality never passes through double.
        if (a instanceof Double || b instanceof Double) {
            double x = a.doubleValue(), y = b.doubleValue();
            return switch (op) { case "==" -> x == y; case "<" -> x < y; case "<=" -> x <= y; case ">" -> x > y; case ">=" -> x >= y; default -> false; };
        }
        if (a instanceof Float || b instanceof Float) {
            float x = a.floatValue(), y = b.floatValue();
            return switch (op) { case "==" -> x == y; case "<" -> x < y; case "<=" -> x <= y; case ">" -> x > y; case ">=" -> x >= y; default -> false; };
        }
        long x = a.longValue(), y = b.longValue();
        return switch (op) { case "==" -> x == y; case "<" -> x < y; case "<=" -> x <= y; case ">" -> x > y; case ">=" -> x >= y; default -> false; };
    }
    private static Object literal(String text, boolean negative) {
        if (!validNumericUnderscores(text)) throw new IllegalArgumentException("The expression contains an invalid Java numeric literal.");
        String normalized = text.replace("_", "");
        boolean hexadecimal = normalized.startsWith("0x") || normalized.startsWith("0X");
        boolean binary = normalized.startsWith("0b") || normalized.startsWith("0B");
        boolean hexadecimalFloat = hexadecimal && (normalized.indexOf('p') >= 0 || normalized.indexOf('P') >= 0);
        char last = normalized.charAt(normalized.length() - 1);
        boolean floatSuffix = (!hexadecimal || hexadecimalFloat) && "fFdD".indexOf(last) >= 0;
        boolean floating = hexadecimalFloat || !binary && !hexadecimal && (
            normalized.indexOf('.') >= 0 || normalized.indexOf('e') >= 0 || normalized.indexOf('E') >= 0 || floatSuffix
        );
        try {
            if (floating) {
                if (last == 'l' || last == 'L') throw new NumberFormatException();
                String magnitude = floatSuffix ? normalized.substring(0, normalized.length() - 1) : normalized;
                String signed = (negative ? "-" : "") + magnitude;
                boolean nonzero;
                if (hexadecimalFloat) {
                    String significand = magnitude.substring(2).split("[pP]", 2)[0].replace(".", "");
                    nonzero = significand.chars().anyMatch(character -> character != '0');
                } else {
                    nonzero = new java.math.BigDecimal(magnitude).signum() != 0;
                }
                if (last == 'f' || last == 'F') {
                    float value = Float.parseFloat(signed);
                    if (!Float.isFinite(value) || value == 0 && nonzero) throw new NumberFormatException();
                    return value;
                }
                double value = Double.parseDouble(signed);
                if (!Double.isFinite(value) || value == 0 && nonzero) throw new NumberFormatException();
                return value;
            }

            boolean longValue = last == 'l' || last == 'L';
            String digits = longValue ? normalized.substring(0, normalized.length() - 1) : normalized;
            int radix = hexadecimal ? 16 : binary ? 2 : isOctalInteger(digits) ? 8 : 10;
            String magnitudeText = hexadecimal || binary ? digits.substring(2) : digits;
            java.math.BigInteger magnitude = new java.math.BigInteger(magnitudeText, radix);
            if (radix == 10) {
                java.math.BigInteger limit = java.math.BigInteger.ONE.shiftLeft(longValue ? 63 : 31);
                if (negative && magnitude.equals(limit)) {
                    if (longValue) return Long.valueOf(Long.MIN_VALUE);
                    return Integer.valueOf(Integer.MIN_VALUE);
                }
                java.math.BigInteger maximum = limit.subtract(java.math.BigInteger.ONE);
                if (magnitude.compareTo(maximum) > 0) throw new NumberFormatException();
                if (negative) magnitude = magnitude.negate();
            } else if (magnitude.bitLength() > (longValue ? 64 : 32)) {
                throw new NumberFormatException();
            } else if (negative) {
                magnitude = magnitude.negate();
            }
            if (longValue) return Long.valueOf(magnitude.longValue());
            return Integer.valueOf(magnitude.intValue());
        } catch (NumberFormatException exception) {
            throw new IllegalArgumentException("The expression numeric literal is invalid or exceeds its Java primitive range.");
        }
    }

    private static boolean isOctalInteger(String text) {
        return text.length() > 1 && text.charAt(0) == '0'
            && text.indexOf('.') < 0 && text.indexOf('e') < 0 && text.indexOf('E') < 0;
    }

    private static boolean validNumericUnderscores(String text) {
        boolean hexadecimal = text.startsWith("0x") || text.startsWith("0X");
        boolean binary = text.startsWith("0b") || text.startsWith("0B");
        int exponent = hexadecimal
            ? Math.max(text.indexOf('p'), text.indexOf('P'))
            : binary ? -1 : Math.max(text.indexOf('e'), text.indexOf('E'));
        int suffixEnd = text.length();
        char last = text.charAt(suffixEnd - 1);
        if ("fFdDlL".indexOf(last) >= 0) suffixEnd--;
        boolean decimalFloatSuffix = !hexadecimal && !binary && "fFdD".indexOf(last) >= 0;
        boolean octal = !hexadecimal && !binary && !decimalFloatSuffix && isOctalInteger(text.substring(0, suffixEnd));
        for (int index = 0; index < text.length(); index++) {
            if (text.charAt(index) != '_') continue;
            if (index == 0 || index + 1 == text.length()) return false;
            int radix;
            if (hexadecimal && exponent >= 0 && index > exponent) radix = 10;
            else if (binary) radix = 2;
            else if (octal) radix = 8;
            else radix = hexadecimal ? 16 : 10;
            if (Character.digit(text.charAt(index - 1), radix) < 0
                || Character.digit(text.charAt(index + 1), radix) < 0) return false;
        }
        return true;
    }

    private static final class Parser {
        private final List<Token> tokens = new ArrayList<>();
        private int offset;
        Parser(String text) {
            for (int index = 0; index < text.length();) {
                if (Character.isWhitespace(text.charAt(index))) { index++; continue; }
                if (text.startsWith("++", index) || text.startsWith("--", index)) throw new IllegalArgumentException("Condition increments are unavailable.");
                char quote = text.charAt(index);
                if (quote == '"' || quote == '\'') {
                    ParsedLiteral literal = quoted(text, index, quote);
                    if (quote == '\'' && literal.value().length() != 1)
                        throw new IllegalArgumentException("A character literal must contain exactly one UTF-16 character.");
                    tokens.add(new Token(literal.value(), quote == '"' ? TokenKind.STRING : TokenKind.CHARACTER));
                    index = literal.end();
                } else {
                    Matcher number = NUMBER.matcher(text);
                    number.region(index, text.length());
                    Matcher path = PATH.matcher(text);
                    path.region(index, text.length());
                    if (number.lookingAt()) {
                        tokens.add(new Token(number.group(), TokenKind.NUMBER));
                        index = number.end();
                    } else if (path.lookingAt()) {
                        String value = path.group();
                        if (value.length() > 512 || value.chars().filter(c -> c == '.' || c == '[').count() > 32)
                            throw new IllegalArgumentException("Expression paths exceed their depth limit.");
                        tokens.add(new Token(value, TokenKind.PATH));
                        index = path.end();
                    } else {
                        String pair = text.substring(index, Math.min(index + 2, text.length()));
                        if (text.startsWith(">>>", index)) {
                            tokens.add(new Token(">>>", TokenKind.SYMBOL));
                            index += 3;
                        } else if (Set.of("==", "!=", "<=", ">=", "&&", "||", "<<", ">>").contains(pair)) {
                            tokens.add(new Token(pair, TokenKind.SYMBOL));
                            index += 2;
                        } else {
                            char value = text.charAt(index++);
                            if ("()[],.+-*/%!<>&|^~?:".indexOf(value) < 0)
                                throw new IllegalArgumentException("Unsupported expression syntax. Method calls and assignments are unavailable.");
                            tokens.add(new Token("" + value, TokenKind.SYMBOL));
                        }
                    }
                }
                if (tokens.size() > 128) throw new IllegalArgumentException("Condition expression exceeds its token limit.");
            }
        }
        private static ParsedLiteral quoted(String source, int start, char quote) {
            StringBuilder value = new StringBuilder();
            for (int index = start + 1; index < source.length(); index++) {
                char current = source.charAt(index);
                if (current == quote) return new ParsedLiteral(value.toString(), index + 1);
                if (current == '\n' || current == '\r') throw new IllegalArgumentException("String and character literals must stay on one line.");
                if (current != '\\') { value.append(current); continue; }
                if (++index >= source.length()) throw new IllegalArgumentException("Incomplete escape in string or character literal.");
                char escaped = source.charAt(index);
                value.append(switch (escaped) {
                    case 'b' -> '\b'; case 't' -> '\t'; case 'n' -> '\n'; case 'f' -> '\f'; case 'r' -> '\r';
                    case '"' -> '"'; case '\'' -> '\''; case '\\' -> '\\';
                    default -> throw new IllegalArgumentException("Unsupported escape in string or character literal.");
                });
            }
            throw new IllegalArgumentException("String or character literal is not closed.");
        }
        private record ParsedLiteral(String value, int end) { }
        Token peek() { return offset < tokens.size() ? tokens.get(offset) : null; }
        Token take() { Token token = peek(); if (token == null) throw new IllegalArgumentException("Incomplete condition expression."); offset++; return token; }
        private boolean acceptSymbol(String symbol) {
            Token token = peek();
            if (token == null || !token.symbol(symbol)) return false;
            offset++;
            return true;
        }
        Expression expression(int minimum, int depth) {
            if (depth > 32) throw new IllegalArgumentException("Condition nesting exceeds its limit.");
            Expression left = primary(depth + 1);
            while (peek() != null && precedence(peek()) >= minimum) {
                Token operation = take();
                String operator = operation.text(); Expression a = left;
                if (operator.equals("instanceof")) {
                    String typeName = referenceTypeName();
                    left = resolver -> resolver.instanceOf(a.evaluate(resolver), typeName);
                    continue;
                }
                Expression b = expression(precedence(operation) + 1, depth + 1);
                left = resolver -> {
                    Object first = a.evaluate(resolver);
                    if (operator.equals("&&")) return truth(first) && truth(b.evaluate(resolver));
                    if (operator.equals("||")) return truth(first) || truth(b.evaluate(resolver));
                    return binary(operator, first, b.evaluate(resolver));
                };
            }
            if (minimum <= 1 && acceptSymbol("?")) {
                Expression whenTrue = expression(1, depth + 1);
                if (!acceptSymbol(":"))
                    throw new IllegalArgumentException("Conditional expression requires a matching colon.");
                Expression whenFalse = expression(1, depth + 1);
                Expression condition = left;
                left = resolver -> truth(condition.evaluate(resolver))
                    ? whenTrue.evaluate(resolver)
                    : whenFalse.evaluate(resolver);
            }
            return left;
        }
        private String referenceTypeName() {
            Token type = take();
            if (!type.path() || type.text().contains("["))
                throw new IllegalArgumentException("instanceof requires a loaded reference type name.");
            StringBuilder name = new StringBuilder(type.text());
            int dimensions = 0;
            while (acceptSymbol("[")) {
                if (!acceptSymbol("]"))
                    throw new IllegalArgumentException("An array type requires empty brackets.");
                if (++dimensions > 32)
                    throw new IllegalArgumentException("The array type exceeds the expression depth limit.");
                name.append("[]");
            }
            if (dimensions == 0 && primitiveType(type.text()))
                throw new IllegalArgumentException("instanceof requires a loaded reference type name.");
            return name.toString();
        }
        Expression primary(int depth) {
            if (depth > 32) throw new IllegalArgumentException("Condition nesting exceeds its limit.");
            Token token = take(); String value = token.text();
            if (token.symbol("(")) {
                if (peek() != null && peek().path() && primitiveType(peek().text())
                    && offset + 1 < tokens.size() && tokens.get(offset + 1).symbol(")")) {
                    String target = take().text();
                    take();
                    Expression operand = primary(depth + 1);
                    return resolver -> castPrimitive(target, operand.evaluate(resolver));
                }
                Expression result = expression(1, depth + 1);
                if (!acceptSymbol(")")) throw new IllegalArgumentException("Condition parentheses do not match.");
                return postfix(result, depth);
            }
            if (token.kind() == TokenKind.SYMBOL && Set.of("!", "+", "-", "~").contains(value)) {
                if (value.equals("-") && peek() != null && peek().number()) {
                    Object number = literal(take().text(), true); return resolver -> number;
                }
                Expression result = primary(depth + 1); return resolver -> unary(value, result.evaluate(resolver));
            }
            if (token.number()) { Object number = literal(value, false); return resolver -> number; }
            if (token.kind() == TokenKind.STRING)
                return postfix(resolver -> new ExpressionString(value, null, true), depth);
            if (token.kind() == TokenKind.CHARACTER) return resolver -> new ExpressionCharacter(value.charAt(0));
            if (token.path()) {
                if (value.equals("true") || value.equals("false")) return resolver -> Boolean.valueOf(value);
                if (value.equals("null")) return resolver -> null;
                if (acceptSymbol("(")) {
                    int methodSeparator = value.lastIndexOf('.');
                    if (methodSeparator < 0)
                        throw new IllegalArgumentException("Method calls and assignments are unavailable.");
                    String method = value.substring(methodSeparator + 1);
                    String receiver = value.substring(0, methodSeparator);
                    return postfix(stringCall(resolver -> resolver.value(receiver), method, depth + 1), depth + 1);
                }
                return postfix(resolver -> resolver.value(value), depth);
            }
            throw new IllegalArgumentException("Expected a read-only condition value.");
        }
        private static boolean primitiveType(String name) {
            return Set.of("boolean", "byte", "short", "char", "int", "long", "float", "double").contains(name);
        }
        private Expression postfix(Expression value, int depth) {
            Expression result = value;
            while (true) {
                if (acceptSymbol("[")) {
                    Expression index = expression(1, ++depth);
                    if (!acceptSymbol("]"))
                        throw new IllegalArgumentException("Array-index brackets do not match.");
                    Expression array = result;
                    result = resolver -> {
                        Object target = array.evaluate(resolver);
                        int position = arrayIndex(index.evaluate(resolver));
                        return resolver.arrayIndex(target, position);
                    };
                } else if (acceptSymbol(".")) {
                    Token suffix = take();
                    if (!suffix.path())
                        throw new IllegalArgumentException("Expected an object member name.");
                    String path = suffix.text();
                    depth += 1 + (int) path.chars().filter(ch -> ch == '.' || ch == '[').count();
                    if (depth > 32)
                        throw new IllegalArgumentException("Expression paths exceed their depth limit.");
                    if (acceptSymbol("(")) {
                        int separator = path.lastIndexOf('.');
                        if (separator >= 0)
                            result = readMemberPath(result, path.substring(0, separator));
                        result = stringCall(result, path.substring(separator + 1), depth);
                    } else {
                        result = readMemberPath(result, path);
                    }
                } else return result;
            }
        }
        private Expression readMemberPath(Expression receiver, String path) {
            return resolver -> resolver.memberPath(receiver.evaluate(resolver), path);
        }
        private Expression stringCall(Expression receiver, String method, int depth) {
            if (depth > 32) throw new IllegalArgumentException("Condition nesting exceeds its limit.");
            List<Expression> arguments = new ArrayList<>();
            if (!acceptSymbol(")")) {
                do {
                    arguments.add(expression(1, depth));
                } while (acceptSymbol(","));
                if (!acceptSymbol(")"))
                    throw new IllegalArgumentException("String method-call parentheses do not match.");
            }
            if (!supportedStringMethod(method, arguments.size()))
                throw new IllegalArgumentException("Method calls and assignments are unavailable.");
            return resolver -> {
                Object target = receiver.evaluate(resolver);
                List<Object> values = new ArrayList<>(arguments.size());
                for (Expression argument : arguments) values.add(argument.evaluate(resolver));
                return stringMethod(target, method, values);
            };
        }
        private static int precedence(Token token) {
            if (token.path()) return token.text().equals("instanceof") ? 7 : 0;
            if (token.kind() != TokenKind.SYMBOL) return 0;
            return switch (token.text()) {
                case "||" -> 1;
                case "&&" -> 2;
                case "|" -> 3;
                case "^" -> 4;
                case "&" -> 5;
                case "==", "!=" -> 6;
                case "<", "<=", ">", ">=" -> 7;
                case "<<", ">>", ">>>" -> 8;
                case "+", "-" -> 9;
                case "*", "/", "%" -> 10;
                default -> 0;
            };
        }
    }
}
