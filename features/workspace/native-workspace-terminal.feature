@REQ-IDE-WORKSPACE-TERMINAL-001 @desktop @native-gui @functional-requirement @resilience @partial @native-workspace-terminal
Business Need: Use an owned interactive shell for saved workspace files
  Java developers need a real terminal for compiler commands, interactive programs and long-running jobs.
  This focused Linux release/no-bundle scenario exercises the production PTY and real GUI keyboard input.
  It qualifies workspace trust, shell state, Java compilation, Ctrl+C, terminal resize, hidden-panel reattachment,
  two independent sessions, renderer reload and normal application close. Other operating systems and packages remain unavailable or unqualified.

  Scenario: Compile Java and stop only processes belonging to the selected terminal
    Given the native workspace terminal has an isolated Java source and two working directories
    When the production desktop opens its integrated terminal
    Then no shell starts before the person trusts workspace shell execution
    When the person starts a shell and compiles Java through the terminal keyboard
    Then the real terminal output and saved files prove Java execution and retained shell state
    When the person hides the terminal, returns and resizes its native window
    Then the same shell remains attached and its real PTY dimensions change
    When the person interrupts a Java program that has run for more than ten seconds
    Then Ctrl+C ends that JVM and the same shell accepts another command
    When the person uses Commands to create, clear and stop selected terminal sessions
    Then Stop preserves the other session and terminates the selected shell and its background job
    When the person reloads the interface with a running terminal and then closes a fresh active session
    Then renderer reload revokes the old terminal and normal application close terminates the final owned jobs
