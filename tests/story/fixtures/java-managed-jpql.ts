import path from "node:path";

export const managedJpqlEntity = "src/main/java/example/jpql/User.java";
export const managedJpqlRepository = "src/main/java/example/jpql/UserRepository.java";

export const managedJpqlApiJars = [
  ["jakarta.persistence", "jakarta.persistence-api", "3.1.0"],
  ["org.springframework.data", "spring-data-jpa", "3.5.0"],
  ["org.springframework.data", "spring-data-commons", "3.5.0"],
  ["org.springframework", "spring-core", "6.2.7"],
].map(([group, artifact, version]) => ({
  group,
  artifact,
  version,
  file: `${artifact}-${version}.jar`,
}));

export function javaManagedJpqlProject(apiDirectory: string): Record<string, string> {
  const dependencies = managedJpqlApiJars.map(({ group, artifact, version, file }) => {
    const location = path.join(apiDirectory, file).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
    return `    <dependency>
      <groupId>${group}</groupId>
      <artifactId>${artifact}</artifactId>
      <version>${version}</version>
      <scope>system</scope>
      <systemPath>${location}</systemPath>
    </dependency>`;
  }).join("\n");
  return {
    "pom.xml": `<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>example.jpql</groupId>
  <artifactId>closed-query-fixture</artifactId>
  <version>1.0</version>
  <properties>
    <maven.compiler.release>21</maven.compiler.release>
    <maven.compiler.proc>none</maven.compiler.proc>
  </properties>
  <dependencies>
${dependencies}
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
        <configuration>
          <release>21</release>
          <proc>none</proc>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
`,
    [managedJpqlEntity]: `package example.jpql;

import jakarta.persistence.Access;
import jakarta.persistence.AccessType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Access(AccessType.FIELD)
@Table(name = "users")
public class User {
    @Id
    private Long id;

    @Column(name = "display_name")
    private String amount;

    protected User() {}
}
`,
    [managedJpqlRepository]: `package example.jpql;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface UserRepository extends JpaRepository<User, Long> {
    @Query("select u.amount from User u where u.amount is not null")
    List<String> readAmounts();
}
`,
  };
}

// This program is compiled outside the provider's workspace. It executes the exact saved
// query and asserts that the database still uses the original physical column.
export const managedJpqlQueryCheck = `import example.jpql.User;
import example.jpql.UserRepository;
import java.util.List;
import org.hibernate.cfg.Configuration;
import org.springframework.data.jpa.repository.Query;

public class CheckSavedQuery {
    public static void main(String[] args) throws ReflectiveOperationException {
        var query = UserRepository.class.getMethod("readAmounts").getAnnotation(Query.class).value();
        var configuration = new Configuration().addAnnotatedClass(User.class)
                .setProperty("hibernate.connection.driver_class", "org.h2.Driver")
                .setProperty("hibernate.connection.url", "jdbc:h2:mem:jpql_rename")
                .setProperty("hibernate.connection.username", "sa")
                .setProperty("hibernate.hbm2ddl.auto", "create-drop");
        try (var factory = configuration.buildSessionFactory(); var session = factory.openSession()) {
            var transaction = session.beginTransaction();
            int rows = session.createNativeMutationQuery(
                    "insert into users (id, display_name) values (1, 'kept'), (2, null)").executeUpdate();
            var result = session.createQuery(query, String.class).getResultList();
            if (rows != 2 || !result.equals(List.of("kept"))) {
                throw new IllegalStateException("Unexpected query result: " + result);
            }
            if (args.length == 1) {
                var namedResult = session.createNamedQuery(args[0], String.class).getResultList();
                if (!namedResult.equals(result)) {
                    throw new IllegalStateException("Unexpected named query result: " + namedResult);
                }
                System.out.println("Verified named JPQL result " + namedResult);
            }
            transaction.commit();
        }
        System.out.println("Verified JPQL result [kept] and column display_name");
    }
}
`;
