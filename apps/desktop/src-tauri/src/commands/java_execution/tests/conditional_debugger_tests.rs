use super::super::debugger_sources::SavedBreakpoint;
use super::super::structured_debugger::{Action, DebugState, Status};
use super::*;
use sha2::{Digest, Sha256};

const PROGRAM: &str = r#"public class Conditional {
  static int methodsCalled;
  static class Holder { boolean flag = true; Boolean active = true; Integer count = 2; int[] values = {3, 5}; int mutate() { methodsCalled++; return 1; } }
  public static void main(String[] args) throws Exception {
    java.nio.file.Files.writeString(java.nio.file.Path.of("conditional-pid.txt"), "" + ProcessHandle.current().pid());
    Holder holder = new Holder();
    Boolean boxedFlag = true;
    Byte boxedByte = 2;
    Short boxedShort = 3;
    Character boxedCharacter = 'A';
    Integer boxedInt = Integer.valueOf(1000);
    Integer boxedTwin = new Integer(1000);
    Long boxedLong = 1001L;
    Float boxedFloat = 1.5f;
    Double boxedDouble = 2.5;
    Integer[] boxedValues = {7, 8};
    Integer boxedIndex = 1;
    Object nullable = null;
    long big = 9007199254740993L;
    for (int i = 0; i < 8; i++) {
      String label = "iteration-" + i;
      int marker = i;
      System.out.println("CONDITIONAL_HIT:" + marker);
    }
    java.nio.file.Files.writeString(java.nio.file.Path.of("conditional-result.txt"), "" + methodsCalled);
  }
}
"#;
fn breakpoint_line() -> u32 {
    (PROGRAM
        .lines()
        .position(|line| line.contains("int marker"))
        .unwrap()
        + 1) as u32
}
fn observe(job: &Arc<Job>, predicate: impl Fn(&DebugState) -> bool) -> DebugState {
    wait_for(job, |snapshot| {
        assert_ne!(snapshot.state, "failed", "{}", snapshot.output);
        snapshot.debugger_state.as_ref().is_some_and(&predicate)
    })
    .debugger_state
    .unwrap()
}
fn advance(job: &Arc<Job>, state: &DebugState) {
    structured_debugger::send(
        job,
        &Action::Continue {
            stop_id: state.stop_id.clone().unwrap(),
        },
    )
    .unwrap();
}
fn fixture_request() -> (PathBuf, CurrentWorkspaceBinding, Request) {
    let (root, binding) = fixture();
    fs::write(root.join("Conditional.java"), PROGRAM).unwrap();
    let mut launch = request(&binding, "debug");
    launch.configuration.main_class = "Conditional".into();
    launch.configuration.debugger_mode = "jdi".into();
    if let Ok(home) = std::env::var("IDE_TEST_ALTERNATE_JDK_HOME") {
        launch.configuration.jdk_home = home;
    }
    (root, binding, launch)
}
fn at(job: &Arc<Job>, expected: &str, after: &DebugState) -> DebugState {
    observe(job, |state| {
        state.status == Status::Suspended
            && state.stop_id != after.stop_id
            && state
                .variables
                .iter()
                .any(|v| v.name == "i" && v.value == expected)
    })
}

#[test]
fn breakpoint_option_bounds_are_checked_before_transport_or_saved_launch() {
    for (condition, hits, log_message) in [
        ("i > 2".into(), 1_000_000_001, String::new()),
        ("i\n> 2".into(), 0, String::new()),
        ("π".repeat(257), 0, String::new()),
        ("a\0b".into(), 0, String::new()),
        (String::new(), 0, "π".repeat(257)),
    ] {
        assert!(
            structured_debugger::validate_breakpoint_options(&condition, hits, &log_message)
                .is_err()
        );
    }
    assert!(structured_debugger::validate_breakpoint_options("i > 2", 1_000_000_000, "").is_ok());
}

#[test]
#[ignore = "requires real JDK/JDI, debugger sockets and process ownership"]
fn real_jdi_saved_conditions_stop_on_matching_hit_and_restart_at_zero() {
    let (root, binding, mut launch) = fixture_request();
    launch.source_breakpoints = vec![SavedBreakpoint {source_path: "Conditional.java".into(), line: breakpoint_line(), fingerprint: format!("{:x}", Sha256::digest(PROGRAM.as_bytes())), condition: "i%2==0&&holder.flag&&holder.active&&holder.count+1==3&&(holder).values.length==2&&boxedFlag&&boxedFlag==true&&boxedByte+boxedShort+boxedCharacter==70&&boxedInt==1000&&boxedInt!=boxedTwin&&boxedInt<boxedLong&&boxedInt+boxedLong==2001L&&boxedFloat+boxedDouble==4.0&&boxedValues[boxedIndex]==8&&big!=9007199254740992L&&nullable==null&&holder instanceof Conditional.Holder&&holder instanceof java.lang.Object&&Conditional.methodsCalled==0&&(i>=0||holder.values[100]==0)".into(), hit_count: 3, log_message: String::new()}];
    let executor = JavaExecutionState::default();
    for _ in 0..2 {
        executor.start(binding.clone(), launch.clone()).unwrap();
        let job = executor.job.lock().unwrap().clone().unwrap();
        let entry = observe(&job, |s| s.reason.as_deref() == Some("entry"));
        assert_eq!(entry.breakpoints[0].hits, 0);
        assert_eq!(entry.breakpoints[0].hit_count, 3);
        advance(&job, &entry);
        let stopped = at(&job, "4", &entry);
        assert_eq!(stopped.reason.as_deref(), Some("breakpoint"));
        assert_eq!(stopped.breakpoints[0].hits, 3);
        assert!(stopped.error.is_none(), "{:?}", stopped.error);
        advance(&job, &stopped);
        let finished = wait_for(&job, |s| s.state == "succeeded");
        assert_eq!(finished.output.matches("CONDITIONAL_HIT:").count(), 8);
        assert_eq!(
            fs::read_to_string(root.join("conditional-result.txt")).unwrap(),
            "0"
        );
    }
    fs::remove_file(root.join("conditional-pid.txt")).unwrap();
    launch.source_breakpoints[0].condition = "false && holder.mutate() == 1".into();
    executor.start(binding, launch).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let refused = wait_for(&job, |s| s.state == "failed");
    assert!(refused.debugger_state.is_none());
    assert!(!root.join("conditional-pid.txt").exists());
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires real JDK/JDI, debugger sockets and process ownership"]
fn real_jdi_runtime_conditions_reset_counts_and_stop_visibly_on_evaluation_errors() {
    let (root, binding, launch) = fixture_request();
    let executor = JavaExecutionState::default();
    executor.start(binding, launch).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let entry = observe(&job, |s| s.reason.as_deref() == Some("entry"));
    let set = |condition: &str, hit_count: u32| {
        structured_debugger::send(
            &job,
            &Action::SetBreakpoint {
                class_name: "Conditional".into(),
                line: breakpoint_line(),
                condition: condition.into(),
                hit_count,
                log_message: String::new(),
            },
        )
        .unwrap()
    };
    set("i >= 2", 2);
    observe(&job, |s| {
        s.breakpoints.len() == 1 && s.breakpoints[0].condition == "i >= 2"
    });
    advance(&job, &entry);
    let first = at(&job, "3", &entry);
    assert_eq!(first.breakpoints[0].hits, 2);
    set("false && holder.mutate() == 1", 0);
    let invalid = observe(&job, |s| s.error.is_some());
    assert_eq!(invalid.breakpoints[0].condition, "i >= 2");
    assert_eq!(invalid.breakpoints[0].hits, 2);
    set("holder.missing > 0", 0);
    let missing = observe(&job, |s| s.breakpoints[0].condition == "holder.missing > 0");
    assert_eq!(missing.breakpoints[0].hits, 0);
    set("i >= 5", 0);
    let reset = observe(&job, |s| s.breakpoints[0].condition == "i >= 5");
    assert_eq!(reset.breakpoints[0].hits, 0);
    advance(&job, &first);
    let fifth = at(&job, "5", &first);
    assert_eq!(fifth.breakpoints[0].hits, 1);
    set("holder.missing > 0", 0);
    observe(&job, |s| s.breakpoints[0].condition == "holder.missing > 0");
    advance(&job, &fifth);
    let sixth = at(&job, "6", &fifth);
    assert!(sixth.error.as_ref().unwrap().contains("evaluation failed"));
    assert_eq!(sixth.breakpoints[0].hits, 0);
    set("i", 0);
    observe(&job, |s| s.breakpoints[0].condition == "i");
    advance(&job, &sixth);
    let seventh = at(&job, "7", &sixth);
    assert!(seventh.error.as_ref().unwrap().contains("boolean"));
    structured_debugger::send(
        &job,
        &Action::ClearBreakpoint {
            class_name: "Conditional".into(),
            line: breakpoint_line(),
        },
    )
    .unwrap();
    observe(&job, |s| s.breakpoints.is_empty());
    advance(&job, &seventh);
    wait_for(&job, |s| s.state == "succeeded");
    assert_eq!(
        fs::read_to_string(root.join("conditional-result.txt")).unwrap(),
        "0"
    );
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires real JDK/JDI, debugger sockets and process ownership"]
fn real_jdi_logpoints_interpolate_read_only_values_without_suspending() {
    let (root, binding, launch) = fixture_request();
    let executor = JavaExecutionState::default();

    executor.start(binding.clone(), launch.clone()).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let _entry = observe(&job, |state| state.reason.as_deref() == Some("entry"));
    structured_debugger::send(
        &job,
        &Action::SetBreakpoint {
            class_name: "Conditional".into(),
            line: breakpoint_line(),
            condition: "i % 2 == 0 && label.substring(0, 10).endsWith(\"-\")".into(),
            hit_count: 2,
            log_message: "runtime {label}: i={i}, first={holder.values[0]}, ref={holder}, boxed={boxedInt}, char={boxedCharacter}, flag={boxedFlag}, literal={\"!?\".substring(0, 1)}".into(),
        },
    )
    .unwrap();
    let configured = observe(&job, |state| {
        state.breakpoints.len() == 1 && state.breakpoints[0].log_message.starts_with("runtime ")
    });
    advance(&job, &configured);
    let runtime = wait_for(&job, |snapshot| snapshot.state == "succeeded");
    assert_eq!(
        runtime.output.matches("[Logpoint]").count(),
        1,
        "{}",
        runtime.output
    );
    assert!(
        runtime
            .output
            .contains("runtime iteration-2: i=2, first=3, ref=Conditional$Holder @"),
        "{}",
        runtime.output
    );
    assert!(
        runtime.output.contains("boxed=1000, char=A, flag=true, literal=!"),
        "{}",
        runtime.output
    );
    assert_eq!(runtime.output.matches("CONDITIONAL_HIT:").count(), 8);
    assert_eq!(
        fs::read_to_string(root.join("conditional-result.txt")).unwrap(),
        "0"
    );

    fs::remove_file(root.join("conditional-pid.txt")).unwrap();
    let mut saved_launch = launch.clone();
    saved_launch.source_breakpoints = vec![SavedBreakpoint {
        source_path: "Conditional.java".into(),
        line: breakpoint_line(),
        fingerprint: format!("{:x}", Sha256::digest(PROGRAM.as_bytes())),
        condition: "i % 2 == 0".into(),
        hit_count: 0,
        log_message: "saved {label} ({i})".into(),
    }];
    executor
        .start(binding.clone(), saved_launch.clone())
        .unwrap();
    let saved_job = executor.job.lock().unwrap().clone().unwrap();
    let saved_entry = observe(&saved_job, |state| state.reason.as_deref() == Some("entry"));
    assert_eq!(
        saved_entry.breakpoints[0].log_message,
        "saved {label} ({i})"
    );
    advance(&saved_job, &saved_entry);
    let saved = wait_for(&saved_job, |snapshot| snapshot.state == "succeeded");
    assert_eq!(
        saved.output.matches("[Logpoint]").count(),
        4,
        "{}",
        saved.output
    );
    assert!(
        saved.output.contains("saved iteration-6 (6)"),
        "{}",
        saved.output
    );
    assert_eq!(saved.output.matches("CONDITIONAL_HIT:").count(), 8);
    assert_eq!(
        fs::read_to_string(root.join("conditional-result.txt")).unwrap(),
        "0"
    );

    fs::remove_file(root.join("conditional-pid.txt")).unwrap();
    saved_launch.source_breakpoints[0].log_message = "forbidden {holder.mutate()}".into();
    executor.start(binding, saved_launch).unwrap();
    let invalid_job = executor.job.lock().unwrap().clone().unwrap();
    let invalid = wait_for(&invalid_job, |snapshot| snapshot.state == "failed");
    assert!(!root.join("conditional-pid.txt").exists());
    assert!(!invalid.output.contains("CONDITIONAL_HIT:"));
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "requires a real JDK compiler and runtime for the Java primitive oracle"]
fn real_java_read_only_condition_operators_match_java_primitive_semantics() {
    let (root, _, launch) = fixture_request();
    let jdk = selected_jdk(&launch.configuration.jdk_home).unwrap();
    fs::write(
        root.join("IdeJavaDebugger.java"),
        structured_debugger::SOURCE,
    )
    .unwrap();
    fs::write(root.join("ConditionOracle.java"), ORACLE).unwrap();
    let compile = Command::new(jdk.join("bin/javac"))
        .arg("--add-modules=jdk.jdi")
        .arg("-d")
        .arg(&root)
        .arg(root.join("IdeJavaDebugger.java"))
        .arg(root.join("ConditionOracle.java"))
        .output()
        .unwrap();
    assert!(
        compile.status.success(),
        "{}",
        String::from_utf8_lossy(&compile.stderr)
    );
    let actual = Command::new(jdk.join("bin/java"))
        .arg("--add-modules=jdk.jdi")
        .arg("-classpath")
        .arg(&root)
        .arg("ConditionOracle")
        .output()
        .unwrap();
    assert!(
        actual.status.success(),
        "{}",
        String::from_utf8_lossy(&actual.stderr)
    );
    assert!(String::from_utf8_lossy(&actual.stdout).contains("CONDITION_ORACLE_OK"));
    fs::remove_dir_all(root).unwrap();
}
const ORACLE: &str = r#"class ConditionOracle {
  static java.util.Map<String, Object> values = new java.util.HashMap<>();
  static com.sun.jdi.ArrayReference array(int... elements) {
    return (com.sun.jdi.ArrayReference) java.lang.reflect.Proxy.newProxyInstance(
      com.sun.jdi.ArrayReference.class.getClassLoader(),
      new Class<?>[] {com.sun.jdi.ArrayReference.class},
      (proxy, method, arguments) -> {
        if (!method.getName().equals("getValue") || arguments.length != 1)
          throw new UnsupportedOperationException(method.getName());
        int element = elements[(Integer) arguments[0]];
        return java.lang.reflect.Proxy.newProxyInstance(
          com.sun.jdi.IntegerValue.class.getClassLoader(),
          new Class<?>[] {com.sun.jdi.IntegerValue.class},
          (integer, integerMethod, integerArguments) -> {
            if (integerMethod.getName().equals("value")) return element;
            throw new UnsupportedOperationException(integerMethod.getName());
          });
      });
  }
  static IdeJavaDebuggerExpressions.ExpressionWrapper boxed(long identity, String type, Object value) {
    return new IdeJavaDebuggerExpressions.ExpressionWrapper(null, identity, type, value);
  }
  static void same(String expression, boolean expected) throws Exception {
    Object actual = IdeJavaDebuggerExpressions.compile(expression).evaluate(new IdeJavaDebuggerExpressions.Resolver() {
      public Object value(String path) {
        if (!values.containsKey(path)) throw new IllegalArgumentException("Unknown value: " + path);
        return values.get(path);
      }
      public boolean instanceOf(Object value, String typeName) throws Exception {
        if (value instanceof IdeJavaDebuggerExpressions.ExpressionWrapper wrapper)
          return Class.forName(typeName).isAssignableFrom(Class.forName(wrapper.typeName()));
        return value != null && Class.forName(typeName).isInstance(value);
      }
    });
    if (!(actual instanceof Boolean) || !actual.equals(expected)) throw new AssertionError(expression + ": " + actual + " != " + expected);
  }
  static void sameValue(String expression, Object expected) throws Exception {
    Object actual = IdeJavaDebuggerExpressions.compile(expression).evaluate(path -> {
      if (!values.containsKey(path)) throw new IllegalArgumentException("Unknown value: " + path);
      return values.get(path);
    });
    if (actual instanceof IdeJavaDebuggerExpressions.ExpressionString string) actual = string.value();
    if (actual instanceof IdeJavaDebuggerExpressions.ExpressionCharacter character) actual = character.value();
    if (!java.util.Objects.equals(actual, expected)) throw new AssertionError(expression + ": " + actual + " != " + expected);
  }
  public static void main(String[] args) throws Exception {
    long large = 9007199254740993L; float nan = Float.NaN; float signed = -0.0f;
    values.put("large", large); values.put("nan", nan); values.put("nanDouble", Double.NaN); values.put("signed", signed); values.put("flag", true); values.put("none", null); values.put("π", 2);
    values.put("text", new IdeJavaDebuggerExpressions.ExpressionString("ready", null, false));
    values.put("array", array(10, 20, 30)); values.put("index", 1);
    values.put("mark", new IdeJavaDebuggerExpressions.ExpressionCharacter('!'));
    values.put("object", new Object());
    values.put("boxedBoolean", boxed(1, "java.lang.Boolean", true));
    values.put("boxedBooleanAlias", boxed(1, "java.lang.Boolean", true));
    values.put("boxedByte", boxed(2, "java.lang.Byte", Byte.valueOf((byte) 2)));
    values.put("boxedShort", boxed(3, "java.lang.Short", Short.valueOf((short) 3)));
    values.put("boxedCharacter", boxed(4, "java.lang.Character", new IdeJavaDebuggerExpressions.ExpressionCharacter('A')));
    values.put("boxedInteger", boxed(5, "java.lang.Integer", 7));
    values.put("boxedIntegerAlias", boxed(5, "java.lang.Integer", 7));
    values.put("boxedIntegerTwin", boxed(6, "java.lang.Integer", 7));
    values.put("boxedLong", boxed(7, "java.lang.Long", 9L));
    values.put("boxedFloat", boxed(8, "java.lang.Float", 1.5f));
    values.put("boxedDouble", boxed(9, "java.lang.Double", 2.5d));
    values.put("boxedIndex", boxed(10, "java.lang.Integer", 1));
    same("object instanceof java.lang.Object", true);
    same("object instanceof java.lang.String", false);
    same("boxedInteger instanceof java.lang.Integer && boxedInteger instanceof java.lang.Number", true);
    same("null instanceof java.lang.String", false);
    same("object instanceof java.lang.Object && 2 + 3 * 4 == 14", true);
    same("large != 9007199254740992L", large != 9007199254740992L);
    same("large == 9007199254740993L", large == 9007199254740993L);
    same("large == 9007199254740992.0", large == 9007199254740992.0);
    same("16777217L == 16777216f", 16777217L == 16777216f);
    same("2147483647 + 1 == -2147483648", 2147483647 + 1 == -2147483648);
    same("-9223372036854775808L / -1L == -9223372036854775808L", -9223372036854775808L / -1L == -9223372036854775808L);
    same("0xffffffff == -1 && 0x80000000 == -2147483648", true);
    same("0xffffffffffffffffL == -1L && 0x8000000000000000L == -9223372036854775808L", true);
    same("0b1010_0110 == 0xa6 && 07_7 == 63 && 0xFF_FF == 65535 && 0x1.fp3 == 15.5", true);
    same("1_000_000 == 1000000 && 0x1_0.p1_0 == 16384 && .5e1_0 == 5000000000.0 && 1_2.5_0 == 12.5 && 0_8f == 8.0f", true);
    same("-0xffffffff == 1 && -0xffffffffffffffffL == 1L", true);
    same("(byte)257 == 1 && (short)65537 == 1 && (char)-1 == 65535", (byte) 257 == 1 && (short) 65537 == 1 && (char) -1 == 65535);
    same("(int)1.9 == 1 && (long)-1.9 == -1L && (int)nanDouble == 0 && (long)nanDouble == 0L", (int) 1.9 == 1 && (long) -1.9 == -1L && (int) Double.NaN == 0 && (long) Double.NaN == 0L);
    same("(float)16777217 == 16777216f && (double)16777217L == 16777217.0", (float) 16777217 == 16777216f && (double) 16777217L == 16777217.0);
    same("~(byte)0 == -1 && +(short)1 == 1 && ((byte)1 << 8) == 256", ~(byte) 0 == -1 && +(short) 1 == 1 && ((byte) 1 << 8) == 256);
    same("array[index + 1] == 30 && array[0x1] == 20", true);
    same("array[(byte)1] == 20 && array[(short)2] == 30", true);
    same("nan != nan && !(nan >= 0) && !(nan < 0)", nan != nan && !(nan >= 0) && !(nan < 0));
    same("signed == 0f && 1f / signed < 0", signed == 0f && 1f / signed < 0);
    same("-7 % 3 == -1 && 7 / 3 == 2 && 7.0 / 2 == 3.5", -7 % 3 == -1 && 7 / 3 == 2 && 7.0 / 2 == 3.5);
    same("(10 & 6) == 2 && (10 | 6) == 14 && (10 ^ 6) == 12", true);
    same("~0 == -1 && ~0L == -1L", true);
    same("-1 >>> 1 == 2147483647 && -1 >> 1 == -1", true);
    same("1 << 31 == -2147483648 && 1L << 63 == -9223372036854775808L", true);
    same("1 << 32 == 1 && 1L << 64 == 1L", true);
    same("true & false | true ^ false", true);
    same("(boolean) flag == true", true);
    same("boxedBoolean && flag && boxedBoolean == true", true);
    same("boxedBoolean == boxedBooleanAlias && boxedBoolean != false", true);
    same("boxedByte + boxedShort + boxedCharacter == 70", true);
    same("boxedInteger + 1 == 8 && boxedInteger < boxedLong && boxedInteger + boxedLong == 16L", true);
    same("boxedFloat + boxedDouble == 4.0 && boxedInteger == boxedIntegerAlias", true);
    same("boxedInteger != boxedIntegerTwin", true);
    same("(double) boxedInteger == 7.0 && (int) boxedLong == 9", true);
    same("'A' + 1 == 66 && 'A' == 65", true);
    same("\"ready\" == \"ready\" && \"ready\" != \"other\"", true);
    sameValue("text + \":\" + mark + 7", "ready:!7");
    sameValue("(byte)257", (byte) 257);
    sameValue("(short)65537", (short) 65537);
    sameValue("(char)-1", (char) -1);
    sameValue("\"x=\" + 2 + 3", "x=23");
    sameValue("\"boxed=\" + boxedInteger", "boxed=7");
    sameValue("array[boxedIndex]", 20);
    sameValue("\"line\\nfeed\"", "line\nfeed");
    sameValue("\"!\"", "!");
    sameValue("'('", '(');
    sameValue("flag ? '+' : '-'", '+');
    same("'+' == 43 && text.indexOf(\")\") == -1 && text.indexOf(\",\", 0) == -1", true);
    sameValue("\"ready\".length()", "ready".length());
    sameValue("(text + \"!\").charAt(5)", ("ready" + "!").charAt(5));
    sameValue("text.substring(1).substring(0, 2)", "ready".substring(1).substring(0, 2));
    same("(flag ? text : \"other\").startsWith(\"rea\") && !\"\".equals(text)", true);
    same("true || (none).isEmpty()", true);
    same("none == null && flag && π == 2", true);
    same("true || unknown[500] > 0", true);
    same("false && unknown.missing > 0", false);
    same("flag ? true : unknown[500] == 0", true);
    same("!flag ? unknown.missing > 0 : true", true);
    same("2 + 3 * 4 == 14 && (2 + 3) * 4 == 20", true);
    sameValue("true || false ? 1 : 0", 1);
    sameValue("true ? false ? 1 : 2 : 3", 2);
    sameValue("false ? 1 : true ? 2 : 3", 2);
    sameValue("flag ? array[index] : 1 / 0", 20);
    sameValue("!flag ? 1 / 0 : array[index]", 20);
    for (String invalid : new String[] {
      "false && object.call()", "i++ == 2", "++i == 2", "i = 2", "i += 2", "08 == 8",
      "2147483648 == 0", "1e-999 == 0", "1e999 > 0", "new Object() == null", "(String) object == null",
      "true ? 1", "true ? : 0", "true : 1", "0x100000000 == 0", "0x10000000000000000L == 0", "0x_FF == 255",
      "1__2 == 12", "1_ == 1", "0b102 == 2", "0x1.0 == 1", "1.0L == 1", "'ab' == 'a'",
      "'\\q' == 'q'", "\"unterminated", "true \"&&\" true", "true '?' 1 ':' 2",
      "(true \")\"", "array \"[\" 0 \"]\"", "object \"instanceof\" java.lang.Object",
      "object instanceof int", "object instanceof java.lang.Object [1]", "object instanceof int[",
      "text.indexOf(0 ',' 1)", "text.indexOf(0 \")\"", "false && (object).call()",
      "\"ready\".substring(1).trim()", "(text).length(1)", "(text).\"length\"()"
    }) {
      try { IdeJavaDebuggerExpressions.compile(invalid); throw new AssertionError("Accepted: " + invalid); } catch (IllegalArgumentException expected) { }
    }
    for (String invalid : new String[] {"1 / 0 == 1", "flag == 1", "none > 0", "unknown", "text == \"ready\"", "\"text\" + object", "~true", "10.5 & 1", "1 << 1.5", "array[1L] == 20", "(boolean) 1 == true", "(int) true == 1", "(none).isEmpty()", "(object).length()"}) {
      try { same(invalid, true); throw new AssertionError("Evaluated: " + invalid); } catch (IllegalArgumentException | ArithmeticException expected) { }
    }
    try { IdeJavaDebuggerExpressions.compile("(".repeat(40) + "true" + ")".repeat(40)); throw new AssertionError("Unbounded nesting"); } catch (IllegalArgumentException expected) { }
    try { IdeJavaDebuggerExpressions.compile("array" + "[index]".repeat(40)); throw new AssertionError("Unbounded array indexing"); } catch (IllegalArgumentException expected) { }
    System.out.println("CONDITION_ORACLE_OK");
  }
}
"#;

#[test]
#[ignore = "requires real JDK/JDI, debugger sockets and process ownership"]
fn real_jdi_muting_preserves_breakpoints_counts_and_resets_for_new_sessions() {
    let (root, binding, mut launch) = fixture_request();
    launch.source_breakpoints = vec![SavedBreakpoint {
        source_path: "Conditional.java".into(), line: breakpoint_line(),
        fingerprint: format!("{:x}", Sha256::digest(PROGRAM.as_bytes())),
        condition: "i >= 0".into(), hit_count: 2, log_message: String::new(),
    }];
    let executor = JavaExecutionState::default();
    executor.start(binding.clone(), launch.clone()).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let entry = observe(&job, |s| s.reason.as_deref() == Some("entry"));
    assert_eq!(entry.breakpoints_muted, Some(false));
    structured_debugger::send(&job, &Action::MuteBreakpoints { muted: true }).unwrap();
    observe(&job, |s| s.breakpoints_muted == Some(true));
    // New requests and reconfiguration must also remain muted before class preparation.
    structured_debugger::send(&job, &Action::SetBreakpoint {
        class_name: "Conditional".into(), line: breakpoint_line() + 1,
        condition: String::new(), hit_count: 0, log_message: "MUTED_LOG:{i}".into(),
    }).unwrap();
    let muted = observe(&job, |s| s.breakpoints.len() == 2);
    advance(&job, &muted);
    let finished = wait_for(&job, |s| s.state == "succeeded");
    assert_eq!(finished.output.matches("CONDITIONAL_HIT:").count(), 8);
    assert!(!finished.output.contains("MUTED_LOG:"));
    assert!(finished.debugger_state.unwrap().breakpoints.iter().all(|b| b.hits == 0));
    executor.start(binding, launch).unwrap();
    let job = executor.job.lock().unwrap().clone().unwrap();
    let entry = observe(&job, |s| s.reason.as_deref() == Some("entry"));
    assert_eq!(entry.breakpoints_muted, Some(false));
    advance(&job, &entry);
    let stopped = at(&job, "1", &entry);
    assert_eq!(stopped.breakpoints[0].hits, 2);
    structured_debugger::send(&job, &Action::MuteBreakpoints { muted: true }).unwrap();
    observe(&job, |s| s.breakpoints_muted == Some(true));
    structured_debugger::send(&job, &Action::MuteBreakpoints { muted: false }).unwrap();
    let unmuted = observe(&job, |s| s.breakpoints_muted == Some(false));
    assert_eq!(unmuted.breakpoints[0].hits, 2);
    assert_eq!(unmuted.breakpoints[0].condition, "i >= 0");
    advance(&job, &unmuted);
    let finished = wait_for(&job, |s| s.state == "succeeded");
    assert_eq!(finished.output.matches("CONDITIONAL_HIT:").count(), 8);
    assert_eq!(fs::read_to_string(root.join("Conditional.java")).unwrap(), PROGRAM);
    executor.shutdown_all();
    fs::remove_dir_all(root).unwrap();
}
