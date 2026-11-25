/** Executes the existing test body in a named loader; leaves JVM stack metadata intact. */
export const JAVA_NAMED_TEST_INVOCATION = `package fixtures.testloader;
public final class NamedTestInvocation {
  public static void invoke(Class<?> testClass, String method) {
    ClassLoader loader = new ClassLoader("native-test-loader", testClass.getClassLoader()) {
      @Override protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
        if (!name.equals(testClass.getName()) && !name.equals("pkg.Unrelated")) {
          return super.loadClass(name, resolve);
        }
        synchronized (getClassLoadingLock(name)) {
          Class<?> loaded = findLoadedClass(name);
          if (loaded == null) {
            String resource = "/" + name.replace('.', '/') + ".class";
            try (java.io.InputStream input = testClass.getResourceAsStream(resource)) {
              if (input == null) throw new ClassNotFoundException(name);
              byte[] bytes = input.readAllBytes();
              loaded = defineClass(name, bytes, 0, bytes.length);
            } catch (java.io.IOException failure) {
              throw new ClassNotFoundException(name, failure);
            }
          }
          if (resolve) resolveClass(loaded);
          return loaded;
        }
      }
    };
    try {
      Class<?> isolated = loader.loadClass(testClass.getName());
      isolated.getMethod(method).invoke(isolated.getConstructor().newInstance());
    } catch (java.lang.reflect.InvocationTargetException failure) {
      Throwable cause = failure.getCause();
      if (cause instanceof Error) throw (Error) cause;
      if (cause instanceof RuntimeException) throw (RuntimeException) cause;
      throw new AssertionError(cause);
    } catch (ReflectiveOperationException failure) {
      throw new AssertionError(failure);
    }
  }
}
`;
