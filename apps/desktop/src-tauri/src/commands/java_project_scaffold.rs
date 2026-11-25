//! Create a small Maven or Gradle Java project without maintaining a competing project model.
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

use crate::app_config::workspace_registry_path;
use crate::commands::workspace_registry::{current_workspace_binding_at, with_root_activation};
use crate::workspace::{resolve_new_path_in_root, workspace_root};

const GRADLE_WRAPPER_JAR: &[u8] =
    include_bytes!("../../resources/java-project-templates/gradle/gradle-wrapper.jar");
const GRADLE_UNIX_WRAPPER: &[u8] =
    include_bytes!("../../resources/java-project-templates/gradle/gradlew");
const GRADLE_WINDOWS_WRAPPER: &[u8] =
    include_bytes!("../../resources/java-project-templates/gradle/gradlew.bat");
const MAVEN_UNIX_WRAPPER: &[u8] =
    include_bytes!("../../resources/java-project-templates/maven/mvnw");
const MAVEN_WINDOWS_WRAPPER: &[u8] =
    include_bytes!("../../resources/java-project-templates/maven/mvnw.cmd");

// The Gradle launchers derive from Gradle 9.8.0 with JDK-compatible distribution
// selection; the Maven scripts come from Maven Wrapper Plugin 3.3.4. Both verify
// the selected official distribution checksum before use.
const MAVEN_VERSION: &str = "3.10.0";
const MAVEN_DISTRIBUTION_SHA256: &str =
    "1f6d9909266510f039f59aa0e13dcd2c66da85f043e56276e41f2918f8bddaff";
const GRADLE_JAVA_8_TO_24_VERSION: &str = "8.14.6";
const GRADLE_JAVA_8_TO_24_DISTRIBUTION_SHA256: &str =
    "7988ed071b2a07900e2ec715fca15c6ab72bce6db433af301fa7fa7e9407bd24";
const GRADLE_JAVA_25_PLUS_VERSION: &str = "9.8.0";
const GRADLE_JAVA_25_PLUS_DISTRIBUTION_SHA256: &str =
    "bafd5ce9cfaea0fbccfdc8439a1ac42fbd4cd9c89dc9a988228d8a2639a58e6c";
const GRADLE_WRAPPER_NETWORK_TIMEOUT_MS: u32 = 120_000;
const SPRING_BOOT_VERSION: &str = "4.1.2";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRequest {
    workspace_id: String,
    generation: u64,
    request_id: String,
    build_system: BuildSystem,
    #[serde(default)]
    gradle_dsl: GradleDsl,
    #[serde(default)]
    framework: ProjectFramework,
    layout: ProjectLayout,
    artifact_id: String,
    group_id: String,
    package_name: String,
    java_release: u8,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum BuildSystem {
    Maven,
    Gradle,
}

#[derive(Clone, Copy, Debug, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum GradleDsl {
    #[default]
    Groovy,
    Kotlin,
}

#[derive(Clone, Copy, Debug, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum ProjectFramework {
    #[default]
    PlainJava,
    SpringBootMvc,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ProjectLayout {
    SingleModule,
    MultiModule,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateResult {
    workspace_id: String,
    generation: u64,
    request_id: String,
    project_path: String,
}

#[tauri::command]
pub async fn create_java_project(
    window: WebviewWindow,
    request: CreateRequest,
) -> Result<CreateResult, String> {
    if window.label() != "main" {
        return Err("Java project creation is restricted to the active workspace window.".into());
    }
    super::blocking::run(move || {
        with_root_activation(|| {
            let root = workspace_root()?;
            let binding = current_workspace_binding_at(&root, &workspace_registry_path()?)?;
            if binding.workspace_id != request.workspace_id {
                return Err("The Java workspace changed before project creation.".into());
            }
            if request.generation == 0 || request.generation > 9_007_199_254_740_991 {
                return Err("The Java workspace generation is invalid.".into());
            }
            let request_id = valid_request_id(&request.request_id)?;
            create_project_at(&binding.canonical_root, &request)?;
            Ok(CreateResult {
                workspace_id: request.workspace_id,
                generation: request.generation,
                request_id,
                // Project-context requests use workspace-relative paths.
                project_path: request.artifact_id.clone(),
            })
        })
    })
    .await
}

fn valid_request_id(value: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > 128 || value.contains('\0') {
        return Err("The project-creation request is invalid.".into());
    }
    Ok(value.to_owned())
}

fn create_project_at(root: &Path, request: &CreateRequest) -> Result<PathBuf, String> {
    validate_artifact_id(&request.artifact_id)?;
    validate_group_id(&request.group_id)?;
    validate_package_name(&request.package_name)?;
    if !matches!(request.java_release, 8 | 11 | 17 | 21 | 25 | 26 | 27) {
        return Err("Choose Java 8, 11, 17, 21, 25, 26, or 27 for the new project.".into());
    }
    validate_framework_settings(request)?;

    let target = resolve_new_path_in_root(root, &request.artifact_id)?;
    // create_dir is the exclusive reservation: an existing project or symlink is never replaced.
    fs::create_dir(&target).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            format!(
                "A path named '{}' already exists in this workspace.",
                request.artifact_id
            )
        } else {
            format!("Cannot create Java project directory: {error}")
        }
    })?;

    let result = write_project_contents(&target, request)
        .and_then(|()| write_wrapper_files(&target, request));
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&target);
        return Err(error);
    }
    target
        .canonicalize()
        .map_err(|error| format!("Cannot resolve the created Java project: {error}"))
}

fn write_project_contents(root: &Path, request: &CreateRequest) -> Result<(), String> {
    if request.framework == ProjectFramework::SpringBootMvc {
        return write_spring_boot_mvc_contents(root, request);
    }
    match request.layout {
        ProjectLayout::SingleModule => write_single_module_contents(root, request),
        ProjectLayout::MultiModule => write_multi_module_contents(root, request),
    }
}

fn validate_framework_settings(request: &CreateRequest) -> Result<(), String> {
    match request.framework {
        ProjectFramework::PlainJava => Ok(()),
        ProjectFramework::SpringBootMvc => match request.layout {
            ProjectLayout::MultiModule => Err(
                "The Spring Boot MVC starter currently supports a single-module project.".into(),
            ),
            ProjectLayout::SingleModule if matches!(request.java_release, 17 | 21 | 25) => Ok(()),
            ProjectLayout::SingleModule => Err(format!(
                "Spring Boot {SPRING_BOOT_VERSION} requires Java 17 or newer; choose Java 17, 21, or 25."
            )),
        },
    }
}

fn write_wrapper_files(root: &Path, request: &CreateRequest) -> Result<(), String> {
    match request.build_system {
        BuildSystem::Maven => {
            write_executable_file(&root.join("mvnw"), MAVEN_UNIX_WRAPPER)?;
            write_new_file(&root.join("mvnw.cmd"), MAVEN_WINDOWS_WRAPPER)?;
            let wrapper_directory = root.join(".mvn/wrapper");
            fs::create_dir_all(&wrapper_directory)
                .map_err(|error| format!("Cannot create Maven wrapper directory: {error}"))?;
            let properties = format!(
                "wrapperVersion=3.3.4\ndistributionType=only-script\ndistributionUrl=https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/{MAVEN_VERSION}/apache-maven-{MAVEN_VERSION}-bin.zip\ndistributionSha256Sum={MAVEN_DISTRIBUTION_SHA256}\n"
            );
            write_new_file(
                &wrapper_directory.join("maven-wrapper.properties"),
                properties.as_bytes(),
            )?;
        }
        BuildSystem::Gradle => {
            write_executable_file(&root.join("gradlew"), GRADLE_UNIX_WRAPPER)?;
            write_new_file(&root.join("gradlew.bat"), GRADLE_WINDOWS_WRAPPER)?;
            let wrapper_directory = root.join("gradle/wrapper");
            fs::create_dir_all(&wrapper_directory)
                .map_err(|error| format!("Cannot create Gradle wrapper directory: {error}"))?;
            let legacy = gradle_wrapper_properties(
                GRADLE_JAVA_8_TO_24_VERSION,
                GRADLE_JAVA_8_TO_24_DISTRIBUTION_SHA256,
            );
            let modern = gradle_wrapper_properties(
                GRADLE_JAVA_25_PLUS_VERSION,
                GRADLE_JAVA_25_PLUS_DISTRIBUTION_SHA256,
            );
            let default_properties = if request.java_release >= 25 {
                modern.as_str()
            } else {
                legacy.as_str()
            };
            // GradleWrapperMain reads the properties file beside its own JAR. The launchers
            // select the variant matching JAVA_HOME, while the standard names remain usable
            // by IDEs and tools that inspect conventional wrapper files.
            write_new_file(
                &wrapper_directory.join("gradle-wrapper.jar"),
                GRADLE_WRAPPER_JAR,
            )?;
            write_new_file(
                &wrapper_directory.join("gradle-wrapper.properties"),
                default_properties.as_bytes(),
            )?;
            write_new_file(
                &wrapper_directory.join("gradle-wrapper-java8.jar"),
                GRADLE_WRAPPER_JAR,
            )?;
            write_new_file(
                &wrapper_directory.join("gradle-wrapper-java8.properties"),
                legacy.as_bytes(),
            )?;
            write_new_file(
                &wrapper_directory.join("gradle-wrapper-java25.jar"),
                GRADLE_WRAPPER_JAR,
            )?;
            write_new_file(
                &wrapper_directory.join("gradle-wrapper-java25.properties"),
                modern.as_bytes(),
            )?;
        }
    }
    Ok(())
}

fn gradle_wrapper_properties(version: &str, checksum: &str) -> String {
    format!(
        "distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionSha256Sum={checksum}\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-{version}-bin.zip\nnetworkTimeout={GRADLE_WRAPPER_NETWORK_TIMEOUT_MS}\nretries=0\nretryBackOffMs=500\nvalidateDistributionUrl=true\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n"
    )
}

fn write_executable_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    write_new_file(path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(|error| {
            format!(
                "Cannot make project wrapper '{}' executable: {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

fn gradle_script_path(directory: &Path, name: &str, dsl: GradleDsl) -> PathBuf {
    let suffix = match dsl {
        GradleDsl::Groovy => "",
        GradleDsl::Kotlin => ".kts",
    };
    directory.join(format!("{name}.gradle{suffix}"))
}

fn gradle_root_project_name(request: &CreateRequest) -> String {
    match request.gradle_dsl {
        GradleDsl::Groovy => format!("rootProject.name = '{}'\n", request.artifact_id),
        GradleDsl::Kotlin => format!("rootProject.name = \"{}\"\n", request.artifact_id),
    }
}

fn gradle_single_module_files(root: &Path, request: &CreateRequest) -> Vec<(PathBuf, String)> {
    let build = match request.gradle_dsl {
        GradleDsl::Groovy => format!(
            "plugins {{\n    id 'application'\n}}\n\ngroup = '{}'\nversion = '1.0.0-SNAPSHOT'\n\nrepositories {{\n    mavenCentral()\n}}\n\ndependencies {{\n    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.2'\n    testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.10.2'\n}}\n\njava {{\n    sourceCompatibility = JavaVersion.toVersion({})\n    targetCompatibility = JavaVersion.toVersion({})\n}}\n\ntasks.withType(JavaCompile).configureEach {{\n    options.encoding = 'UTF-8'\n    options.release = {}\n}}\n\ntasks.named('test', Test) {{\n    useJUnitPlatform()\n}}\n\napplication {{\n    mainClass = '{}.App'\n}}\n",
            request.group_id,
            request.java_release,
            request.java_release,
            request.java_release,
            request.package_name
        ),
        GradleDsl::Kotlin => format!(
            "plugins {{\n    application\n}}\n\ngroup = \"{}\"\nversion = \"1.0.0-SNAPSHOT\"\n\nrepositories {{\n    mavenCentral()\n}}\n\ndependencies {{\n    testImplementation(\"org.junit.jupiter:junit-jupiter:5.10.2\")\n    testRuntimeOnly(\"org.junit.platform:junit-platform-launcher:1.10.2\")\n}}\n\njava {{\n    sourceCompatibility = JavaVersion.toVersion({})\n    targetCompatibility = JavaVersion.toVersion({})\n}}\n\ntasks.withType<JavaCompile>().configureEach {{\n    options.encoding = \"UTF-8\"\n    options.release = {}\n}}\n\ntasks.test {{\n    useJUnitPlatform()\n}}\n\napplication {{\n    mainClass = \"{}.App\"\n}}\n",
            request.group_id,
            request.java_release,
            request.java_release,
            request.java_release,
            request.package_name
        ),
    };
    vec![
        (
            gradle_script_path(root, "settings", request.gradle_dsl),
            gradle_root_project_name(request),
        ),
        (gradle_script_path(root, "build", request.gradle_dsl), build),
    ]
}

fn gradle_multi_module_files(
    root: &Path,
    request: &CreateRequest,
    library_root: &Path,
    app_root: &Path,
) -> Vec<(PathBuf, String)> {
    let settings = match request.gradle_dsl {
        GradleDsl::Groovy => format!(
            "rootProject.name = '{}'\ninclude 'library', 'app'\n",
            request.artifact_id
        ),
        GradleDsl::Kotlin => format!(
            "rootProject.name = \"{}\"\ninclude(\"library\", \"app\")\n",
            request.artifact_id
        ),
    };
    let root_build = match request.gradle_dsl {
        GradleDsl::Groovy => format!(
            "allprojects {{\n    group = '{}'\n    version = '1.0.0-SNAPSHOT'\n    repositories {{\n        mavenCentral()\n    }}\n}}\n\nsubprojects {{\n    tasks.withType(JavaCompile).configureEach {{\n        options.encoding = 'UTF-8'\n        options.release = {}\n    }}\n    tasks.withType(Test).configureEach {{\n        useJUnitPlatform()\n    }}\n}}\n",
            request.group_id, request.java_release
        ),
        GradleDsl::Kotlin => format!(
            "allprojects {{\n    group = \"{}\"\n    version = \"1.0.0-SNAPSHOT\"\n    repositories {{\n        mavenCentral()\n    }}\n}}\n\nsubprojects {{\n    tasks.withType<JavaCompile>().configureEach {{\n        options.encoding = \"UTF-8\"\n        options.release = {}\n    }}\n    tasks.withType<Test>().configureEach {{\n        useJUnitPlatform()\n    }}\n}}\n",
            request.group_id, request.java_release
        ),
    };
    let library_build = match request.gradle_dsl {
        GradleDsl::Groovy => "plugins {\n    id 'java-library'\n}\n\ndependencies {\n    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.2'\n    testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.10.2'\n}\n".to_owned(),
        GradleDsl::Kotlin => "plugins {\n    `java-library`\n}\n\ndependencies {\n    testImplementation(\"org.junit.jupiter:junit-jupiter:5.10.2\")\n    testRuntimeOnly(\"org.junit.platform:junit-platform-launcher:1.10.2\")\n}\n".to_owned(),
    };
    let app_build = match request.gradle_dsl {
        GradleDsl::Groovy => format!(
            "plugins {{\n    id 'application'\n}}\n\ndependencies {{\n    implementation project(':library')\n    testImplementation 'org.junit.jupiter:junit-jupiter:5.10.2'\n    testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.10.2'\n}}\n\napplication {{\n    mainClass = '{}.App'\n}}\n",
            request.package_name
        ),
        GradleDsl::Kotlin => format!(
            "plugins {{\n    application\n}}\n\ndependencies {{\n    implementation(project(\":library\"))\n    testImplementation(\"org.junit.jupiter:junit-jupiter:5.10.2\")\n    testRuntimeOnly(\"org.junit.platform:junit-platform-launcher:1.10.2\")\n}}\n\napplication {{\n    mainClass = \"{}.App\"\n}}\n",
            request.package_name
        ),
    };
    vec![
        (
            gradle_script_path(root, "settings", request.gradle_dsl),
            settings,
        ),
        (
            gradle_script_path(root, "build", request.gradle_dsl),
            root_build,
        ),
        (
            gradle_script_path(library_root, "build", request.gradle_dsl),
            library_build,
        ),
        (
            gradle_script_path(app_root, "build", request.gradle_dsl),
            app_build,
        ),
    ]
}

fn spring_boot_mvc_files(root: &Path, request: &CreateRequest) -> Vec<(PathBuf, String)> {
    let build = match request.build_system {
        BuildSystem::Maven => format!(
            r#"<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>{SPRING_BOOT_VERSION}</version>
    <relativePath/>
  </parent>
  <groupId>{}</groupId>
  <artifactId>{}</artifactId>
  <version>1.0.0-SNAPSHOT</version>
  <properties>
    <java.version>{}</java.version>
    <maven.compiler.release>{}</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-webmvc</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
"#,
            request.group_id, request.artifact_id, request.java_release, request.java_release
        ),
        BuildSystem::Gradle => match request.gradle_dsl {
            GradleDsl::Groovy => format!(
                r#"plugins {{
    id 'java'
    id 'org.springframework.boot' version '{SPRING_BOOT_VERSION}'
}}

group = '{}'
version = '1.0.0-SNAPSHOT'

repositories {{
    mavenCentral()
}}

dependencies {{
    implementation platform('org.springframework.boot:spring-boot-dependencies:{SPRING_BOOT_VERSION}')
    implementation 'org.springframework.boot:spring-boot-starter-webmvc'
    testImplementation platform('org.springframework.boot:spring-boot-dependencies:{SPRING_BOOT_VERSION}')
    testImplementation 'org.springframework.boot:spring-boot-starter-test'
    testRuntimeOnly 'org.junit.platform:junit-platform-launcher'
}}

java {{
    sourceCompatibility = JavaVersion.toVersion({})
    targetCompatibility = JavaVersion.toVersion({})
}}

tasks.withType(JavaCompile).configureEach {{
    options.encoding = 'UTF-8'
    options.release = {}
}}

tasks.named('test', Test) {{
    useJUnitPlatform()
}}
"#,
                request.group_id, request.java_release, request.java_release, request.java_release
            ),
            GradleDsl::Kotlin => format!(
                r#"plugins {{
    java
    id("org.springframework.boot") version "{SPRING_BOOT_VERSION}"
}}

group = "{}"
version = "1.0.0-SNAPSHOT"

repositories {{
    mavenCentral()
}}

dependencies {{
    implementation(platform("org.springframework.boot:spring-boot-dependencies:{SPRING_BOOT_VERSION}"))
    implementation("org.springframework.boot:spring-boot-starter-webmvc")
    testImplementation(platform("org.springframework.boot:spring-boot-dependencies:{SPRING_BOOT_VERSION}"))
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}}

java {{
    sourceCompatibility = JavaVersion.toVersion({})
    targetCompatibility = JavaVersion.toVersion({})
}}

tasks.withType<JavaCompile>().configureEach {{
    options.encoding = "UTF-8"
    options.release = {}
}}

tasks.test {{
    useJUnitPlatform()
}}
"#,
                request.group_id, request.java_release, request.java_release, request.java_release
            ),
        },
    };
    match request.build_system {
        BuildSystem::Maven => vec![(root.join("pom.xml"), build)],
        BuildSystem::Gradle => vec![
            (
                gradle_script_path(root, "settings", request.gradle_dsl),
                gradle_root_project_name(request),
            ),
            (gradle_script_path(root, "build", request.gradle_dsl), build),
        ],
    }
}

fn write_spring_boot_mvc_contents(root: &Path, request: &CreateRequest) -> Result<(), String> {
    let package_path = request.package_name.replace('.', "/");
    let main_dir = root.join("src/main/java").join(&package_path);
    let test_dir = root.join("src/test/java").join(&package_path);
    fs::create_dir_all(&main_dir)
        .map_err(|error| format!("Cannot create Java source folder: {error}"))?;
    fs::create_dir_all(&test_dir)
        .map_err(|error| format!("Cannot create Java test folder: {error}"))?;
    let run_command = match request.build_system {
        BuildSystem::Maven => "`./mvnw spring-boot:run` (`mvnw.cmd spring-boot:run` on Windows)",
        BuildSystem::Gradle => "`./gradlew bootRun` (`gradlew.bat bootRun` on Windows)",
    };
    let test_command = match request.build_system {
        BuildSystem::Maven => "`./mvnw test` (`mvnw.cmd test` on Windows)",
        BuildSystem::Gradle => "`./gradlew test` (`gradlew.bat test` on Windows)",
    };
    let wrapper_note = wrapper_note(request.build_system);
    let build_files = spring_boot_mvc_files(root, request);
    let common_files = [
        (
            main_dir.join("App.java"),
            format!(
                "package {};\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n@SpringBootApplication\npublic class App {{\n    public static void main(String[] args) {{\n        SpringApplication.run(App.class, args);\n    }}\n}}\n",
                request.package_name
            ),
        ),
        (
            main_dir.join("GreetingController.java"),
            format!(
                "package {};\n\nimport org.springframework.web.bind.annotation.GetMapping;\nimport org.springframework.web.bind.annotation.RestController;\n\n@RestController\npublic class GreetingController {{\n    @GetMapping(\"/api/hello\")\n    public String hello() {{\n        return \"Hello from {}!\";\n    }}\n}}\n",
                request.package_name, request.artifact_id
            ),
        ),
        (
            test_dir.join("GreetingControllerTest.java"),
            format!(
                "package {};\n\nimport static org.junit.jupiter.api.Assertions.assertEquals;\nimport org.junit.jupiter.api.Test;\nimport org.springframework.boot.test.context.SpringBootTest;\nimport org.springframework.boot.test.web.server.LocalServerPort;\nimport java.net.URI;\nimport java.net.http.HttpClient;\nimport java.net.http.HttpRequest;\nimport java.net.http.HttpResponse;\n\n@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)\nclass GreetingControllerTest {{\n    @LocalServerPort\n    private int port;\n\n    @Test\n    void servesTheGreetingEndpoint() throws Exception {{\n        var request = HttpRequest.newBuilder(URI.create(\"http://127.0.0.1:\" + port + \"/api/hello\")).GET().build();\n        var response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());\n        assertEquals(200, response.statusCode());\n        assertEquals(\"Hello from {}!\", response.body());\n    }}\n}}\n",
                request.package_name, request.artifact_id
            ),
        ),
        (root.join(".gitignore"), "target/\n.idea/\n*.iml\n".to_owned()),
        (
            root.join("README.md"),
            format!(
                "# {}\n\nA Spring Boot {SPRING_BOOT_VERSION} MVC application targeting Java {}. It exposes `GET /api/hello` from the `{}.GreetingController` class.\n\nRun {test_command} to compile and test it, then {run_command}. The first build downloads Spring dependencies from Maven Central. {wrapper_note}\n",
                request.artifact_id, request.java_release, request.package_name
            ),
        ),
    ];
    for (path, content) in build_files.into_iter().chain(common_files) {
        write_new_file(&path, content.as_bytes())?;
    }
    Ok(())
}

fn write_single_module_contents(root: &Path, request: &CreateRequest) -> Result<(), String> {
    let package_path = request.package_name.replace('.', "/");
    let main_dir = root.join("src/main/java").join(&package_path);
    let test_dir = root.join("src/test/java").join(&package_path);
    fs::create_dir_all(&main_dir)
        .map_err(|error| format!("Cannot create Java source folder: {error}"))?;
    fs::create_dir_all(&test_dir)
        .map_err(|error| format!("Cannot create Java test folder: {error}"))?;

    let build_files = match request.build_system {
        BuildSystem::Maven => vec![(
            root.join("pom.xml"),
            format!(
                "<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>{}</groupId>\n  <artifactId>{}</artifactId>\n  <version>1.0.0-SNAPSHOT</version>\n  <properties>\n    <maven.compiler.release>{}</maven.compiler.release>\n    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>\n    <junit.version>5.10.2</junit.version>\n  </properties>\n  <dependencies>\n    <dependency>\n      <groupId>org.junit.jupiter</groupId>\n      <artifactId>junit-jupiter</artifactId>\n      <version>${{junit.version}}</version>\n      <scope>test</scope>\n    </dependency>\n  </dependencies>\n  <build>\n    <plugins>\n      <plugin>\n        <groupId>org.apache.maven.plugins</groupId>\n        <artifactId>maven-compiler-plugin</artifactId>\n        <version>3.13.0</version>\n      </plugin>\n      <plugin>\n        <groupId>org.apache.maven.plugins</groupId>\n        <artifactId>maven-surefire-plugin</artifactId>\n        <version>3.2.5</version>\n      </plugin>\n    </plugins>\n  </build>\n</project>\n",
                request.group_id, request.artifact_id, request.java_release
            ),
        )],
        BuildSystem::Gradle => gradle_single_module_files(root, request),
    };
    let build_ignore = match request.build_system {
        BuildSystem::Maven => "target/\n",
        BuildSystem::Gradle => "build/\n.gradle/\n",
    };
    let build_tool = match request.build_system {
        BuildSystem::Maven => "Maven",
        BuildSystem::Gradle => match request.gradle_dsl {
            GradleDsl::Groovy => "Gradle Groovy DSL",
            GradleDsl::Kotlin => "Gradle Kotlin DSL",
        },
    };
    let test_command = match request.build_system {
        BuildSystem::Maven => "`./mvnw test` (`mvnw.cmd test` on Windows)",
        BuildSystem::Gradle => "`./gradlew test` (`gradlew.bat test` on Windows)",
    };
    let run_command = match request.build_system {
        BuildSystem::Maven => "launch the application from your IDE",
        BuildSystem::Gradle => "`./gradlew run` (`gradlew.bat run` on Windows)",
    };
    let wrapper_note = wrapper_note(request.build_system);
    let common_files = [
        (
            main_dir.join("App.java"),
            format!(
                "package {};\n\npublic final class App {{\n    private App() {{}}\n\n    public static String message() {{\n        return \"Hello from {}!\";\n    }}\n\n    public static void main(String[] args) {{\n        System.out.println(message());\n    }}\n}}\n",
                request.package_name, request.artifact_id
            ),
        ),
        (
            test_dir.join("AppTest.java"),
            format!(
                "package {};\n\nimport static org.junit.jupiter.api.Assertions.assertEquals;\nimport org.junit.jupiter.api.Test;\n\nclass AppTest {{\n    @Test\n    void returnsTheGreeting() {{\n        assertEquals(\"Hello from {}!\", App.message());\n    }}\n}}\n",
                request.package_name, request.artifact_id
            ),
        ),
        (
            root.join(".gitignore"),
            format!("{build_ignore}.idea/\n*.iml\n"),
        ),
        (
            root.join("README.md"),
            format!(
                "# {}\n\nA Java {} {build_tool} project with a pinned build-tool wrapper.\n\nRun {test_command} to compile and test it, then {run_command}. {wrapper_note}\n",
                request.artifact_id, request.java_release
            ),
        ),
    ];
    for (path, content) in build_files.into_iter().chain(common_files) {
        write_new_file(&path, content.as_bytes())?;
    }
    Ok(())
}

fn write_multi_module_contents(root: &Path, request: &CreateRequest) -> Result<(), String> {
    let package_path = request.package_name.replace('.', "/");
    let app_root = root.join("app");
    let library_root = root.join("library");
    let app_main = app_root.join("src/main/java").join(&package_path);
    let app_test_dir = app_root.join("src/test/java").join(&package_path);
    let library_main = library_root.join("src/main/java").join(&package_path);
    let library_test_dir = library_root.join("src/test/java").join(&package_path);
    for directory in [&app_main, &app_test_dir, &library_main, &library_test_dir] {
        fs::create_dir_all(directory)
            .map_err(|error| format!("Cannot create Java module source folder: {error}"))?;
    }

    let app_class = format!(
        "package {};\n\npublic final class App {{\n    private App() {{}}\n\n    public static String message() {{\n        return Greeting.message();\n    }}\n\n    public static void main(String[] args) {{\n        System.out.println(message());\n    }}\n}}\n",
        request.package_name
    );
    let greeting_class = format!(
        "package {};\n\npublic final class Greeting {{\n    private Greeting() {{}}\n\n    public static String message() {{\n        return \"Hello from {}!\";\n    }}\n}}\n",
        request.package_name, request.artifact_id
    );
    let app_test = format!(
        "package {};\n\nimport static org.junit.jupiter.api.Assertions.assertEquals;\nimport org.junit.jupiter.api.Test;\n\nclass AppTest {{\n    @Test\n    void usesTheLibraryModule() {{\n        assertEquals(\"Hello from {}!\", App.message());\n    }}\n}}\n",
        request.package_name, request.artifact_id
    );
    let library_test = format!(
        "package {};\n\nimport static org.junit.jupiter.api.Assertions.assertEquals;\nimport org.junit.jupiter.api.Test;\n\nclass GreetingTest {{\n    @Test\n    void returnsTheGreeting() {{\n        assertEquals(\"Hello from {}!\", Greeting.message());\n    }}\n}}\n",
        request.package_name, request.artifact_id
    );

    let build_files = match request.build_system {
        BuildSystem::Maven => vec![
            (
                root.join("pom.xml"),
                format!(
                    "<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>{}</groupId>\n  <artifactId>{}</artifactId>\n  <version>1.0.0-SNAPSHOT</version>\n  <packaging>pom</packaging>\n  <modules>\n    <module>library</module>\n    <module>app</module>\n  </modules>\n  <properties>\n    <maven.compiler.release>{}</maven.compiler.release>\n    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>\n    <junit.version>5.10.2</junit.version>\n  </properties>\n  <build>\n    <plugins>\n      <plugin>\n        <groupId>org.apache.maven.plugins</groupId>\n        <artifactId>maven-compiler-plugin</artifactId>\n        <version>3.13.0</version>\n      </plugin>\n      <plugin>\n        <groupId>org.apache.maven.plugins</groupId>\n        <artifactId>maven-surefire-plugin</artifactId>\n        <version>3.2.5</version>\n      </plugin>\n    </plugins>\n  </build>\n</project>\n",
                    request.group_id, request.artifact_id, request.java_release
                ),
            ),
            (
                library_root.join("pom.xml"),
                maven_child_pom(request, "library", None),
            ),
            (
                app_root.join("pom.xml"),
                maven_child_pom(request, "app", Some("library")),
            ),
        ],
        BuildSystem::Gradle => {
            gradle_multi_module_files(root, request, &library_root, &app_root)
        }
    };
    let build_ignore = match request.build_system {
        BuildSystem::Maven => "target/\n",
        BuildSystem::Gradle => "build/\n.gradle/\n",
    };
    let build_tool = match request.build_system {
        BuildSystem::Maven => "Maven",
        BuildSystem::Gradle => match request.gradle_dsl {
            GradleDsl::Groovy => "Gradle Groovy DSL",
            GradleDsl::Kotlin => "Gradle Kotlin DSL",
        },
    };
    let test_command = match request.build_system {
        BuildSystem::Maven => "`./mvnw test` (`mvnw.cmd test` on Windows)",
        BuildSystem::Gradle => "`./gradlew test` (`gradlew.bat test` on Windows)",
    };
    let run_command = match request.build_system {
        BuildSystem::Maven => "launch the application module from your IDE",
        BuildSystem::Gradle => "`./gradlew :app:run` (`gradlew.bat :app:run` on Windows)",
    };
    let wrapper_note = wrapper_note(request.build_system);
    let common_files = [
        (app_main.join("App.java"), app_class),
        (library_main.join("Greeting.java"), greeting_class),
        (app_test_dir.join("AppTest.java"), app_test),
        (library_test_dir.join("GreetingTest.java"), library_test),
        (
            root.join(".gitignore"),
            format!("{build_ignore}.idea/\n*.iml\n"),
        ),
        (
            root.join("README.md"),
            format!(
                "# {}\n\nA Java {} {build_tool} multi-module project with an application, a library and a pinned build-tool wrapper.\n\nRun {test_command} to compile and test both modules, then {run_command}. {wrapper_note}\n",
                request.artifact_id, request.java_release
            ),
        ),
    ];
    for (path, content) in build_files.into_iter().chain(common_files) {
        write_new_file(&path, content.as_bytes())?;
    }
    Ok(())
}

fn wrapper_note(build_system: BuildSystem) -> &'static str {
    match build_system {
        BuildSystem::Maven => {
            "On first use, the wrapper downloads Maven 3.10.0 and verifies its SHA-256 checksum."
        }
        BuildSystem::Gradle => "On first use, the wrapper downloads and verifies a Gradle distribution compatible with the build JDK: Gradle 8.14.6 for JDK 8 through 24, or Gradle 9.8.0 for JDK 25 and later.",
    }
}

fn maven_child_pom(
    request: &CreateRequest,
    module: &str,
    library_dependency: Option<&str>,
) -> String {
    let mut pom = format!(
        "<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>{}</groupId>\n    <artifactId>{}</artifactId>\n    <version>1.0.0-SNAPSHOT</version>\n    <relativePath>../pom.xml</relativePath>\n  </parent>\n  <artifactId>{}-{}</artifactId>\n  <dependencies>\n",
        request.group_id, request.artifact_id, request.artifact_id, module
    );
    if let Some(dependency) = library_dependency {
        pom.push_str(&format!(
            "    <dependency>\n      <groupId>{}</groupId>\n      <artifactId>{}-{}</artifactId>\n      <version>${{project.version}}</version>\n    </dependency>\n",
            request.group_id, request.artifact_id, dependency
        ));
    }
    pom.push_str(
        "    <dependency>\n      <groupId>org.junit.jupiter</groupId>\n      <artifactId>junit-jupiter</artifactId>\n      <version>${junit.version}</version>\n      <scope>test</scope>\n    </dependency>\n  </dependencies>\n</project>\n",
    );
    pom
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("Cannot create project file '{}': {error}", path.display()))?;
    file.write_all(bytes)
        .map_err(|error| format!("Cannot write project file '{}': {error}", path.display()))
}

fn validate_artifact_id(value: &str) -> Result<(), String> {
    if value.len() > 64
        || value.is_empty()
        || !value.as_bytes()[0].is_ascii_alphanumeric()
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        || value == "."
        || value == ".."
    {
        return Err("Artifact ID must start with a letter or number and contain only letters, numbers, '.', '_' or '-'.".into());
    }
    Ok(())
}

fn validate_group_id(value: &str) -> Result<(), String> {
    if value.len() > 192
        || value.is_empty()
        || value.split('.').any(|part| {
            part.is_empty()
                || !part.as_bytes()[0].is_ascii_alphanumeric()
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        })
    {
        return Err(
            "Group ID must contain dot-separated letters, numbers, '_' or '-' segments.".into(),
        );
    }
    Ok(())
}

fn validate_package_name(value: &str) -> Result<(), String> {
    const KEYWORDS: &[&str] = &[
        "abstract",
        "assert",
        "boolean",
        "break",
        "byte",
        "case",
        "catch",
        "char",
        "class",
        "const",
        "continue",
        "default",
        "do",
        "double",
        "else",
        "enum",
        "extends",
        "final",
        "finally",
        "float",
        "for",
        "goto",
        "if",
        "implements",
        "import",
        "instanceof",
        "int",
        "interface",
        "long",
        "native",
        "new",
        "package",
        "private",
        "protected",
        "public",
        "return",
        "short",
        "static",
        "strictfp",
        "super",
        "switch",
        "synchronized",
        "this",
        "throw",
        "throws",
        "transient",
        "try",
        "void",
        "volatile",
        "while",
        "_",
        "true",
        "false",
        "null",
        "exports",
        "module",
        "open",
        "opens",
        "permits",
        "provides",
        "record",
        "requires",
        "sealed",
        "transitive",
        "uses",
        "var",
        "when",
        "with",
        "yield",
    ];
    let valid = !value.is_empty()
        && value.len() <= 192
        && value.split('.').all(|part| {
            let mut bytes = part.bytes();
            let Some(first) = bytes.next() else {
                return false;
            };
            (first.is_ascii_alphabetic() || first == b'_')
                && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
                && !KEYWORDS.contains(&part)
        });
    if !valid {
        return Err(
            "Package name must be dot-separated Java identifiers and cannot contain Java keywords."
                .into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> (PathBuf, CreateRequest) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("ide-java-scaffold-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        let request = CreateRequest {
            workspace_id: "workspace".into(),
            generation: 1,
            request_id: "request".into(),
            build_system: BuildSystem::Maven,
            gradle_dsl: GradleDsl::Groovy,
            framework: ProjectFramework::PlainJava,
            layout: ProjectLayout::SingleModule,
            artifact_id: "hello-java".into(),
            group_id: "com.example".into(),
            package_name: "com.example.hello".into(),
            java_release: 17,
        };
        (root, request)
    }

    #[test]
    fn creates_a_complete_maven_starter_with_a_pinned_wrapper_without_running_build_code() {
        let (root, request) = fixture();
        let project = create_project_at(&root, &request).unwrap();
        assert!(project.join("pom.xml").is_file());
        assert!(project
            .join("src/main/java/com/example/hello/App.java")
            .is_file());
        assert!(project
            .join("src/test/java/com/example/hello/AppTest.java")
            .is_file());
        assert!(project.join(".gitignore").is_file());
        assert!(project.join("mvnw").is_file());
        assert!(project.join("mvnw.cmd").is_file());
        assert!(!project.join("gradlew").exists());
        let wrapper =
            fs::read_to_string(project.join(".mvn/wrapper/maven-wrapper.properties")).unwrap();
        assert!(wrapper.contains("wrapperVersion=3.3.4"));
        assert!(wrapper.contains("distributionType=only-script"));
        assert!(wrapper.contains("apache-maven-3.10.0-bin.zip"));
        assert!(wrapper.contains(&format!(
            "distributionSha256Sum={MAVEN_DISTRIBUTION_SHA256}"
        )));
        assert!(fs::read_to_string(project.join("pom.xml"))
            .unwrap()
            .contains("<maven.compiler.release>17</maven.compiler.release>"));
        assert!(fs::read_to_string(project.join("README.md"))
            .unwrap()
            .contains("./mvnw test"));
        assert!(
            fs::read_to_string(project.join("src/main/java/com/example/hello/App.java"))
                .unwrap()
                .contains("package com.example.hello;")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_a_spring_boot_mvc_maven_starter_with_a_tested_endpoint_source() {
        let (root, mut request) = fixture();
        request.framework = ProjectFramework::SpringBootMvc;
        request.java_release = 25;
        let project = create_project_at(&root, &request).unwrap();
        let pom = fs::read_to_string(project.join("pom.xml")).unwrap();
        let app =
            fs::read_to_string(project.join("src/main/java/com/example/hello/App.java")).unwrap();
        let controller = fs::read_to_string(
            project.join("src/main/java/com/example/hello/GreetingController.java"),
        )
        .unwrap();
        let test = fs::read_to_string(
            project.join("src/test/java/com/example/hello/GreetingControllerTest.java"),
        )
        .unwrap();
        assert!(pom.contains(&format!("<version>{SPRING_BOOT_VERSION}</version>")));
        assert!(pom.contains("<artifactId>spring-boot-starter-webmvc</artifactId>"));
        assert!(pom.contains("<artifactId>spring-boot-starter-test</artifactId>"));
        assert!(pom.contains("<java.version>25</java.version>"));
        assert!(app.contains("@SpringBootApplication"));
        assert!(controller.contains("@GetMapping(\"/api/hello\")"));
        assert!(controller.contains("Hello from hello-java!"));
        assert!(test.contains("servesTheGreetingEndpoint"));
        assert!(test.contains("SpringBootTest.WebEnvironment.RANDOM_PORT"));
        assert!(project.join("mvnw").is_file());
        assert!(!project.join("target").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_spring_boot_mvc_groovy_and_kotlin_gradle_builds() {
        for dsl in [GradleDsl::Groovy, GradleDsl::Kotlin] {
            let (root, mut request) = fixture();
            request.build_system = BuildSystem::Gradle;
            request.framework = ProjectFramework::SpringBootMvc;
            request.gradle_dsl = dsl;
            request.java_release = 21;
            let project = create_project_at(&root, &request).unwrap();
            let build_path = gradle_script_path(&project, "build", dsl);
            let build = fs::read_to_string(build_path).unwrap();
            let settings =
                fs::read_to_string(gradle_script_path(&project, "settings", dsl)).unwrap();
            let expected_settings = match dsl {
                GradleDsl::Groovy => format!("rootProject.name = '{}'\n", request.artifact_id),
                GradleDsl::Kotlin => format!("rootProject.name = \"{}\"\n", request.artifact_id),
            };
            assert_eq!(settings, expected_settings);
            assert!(
                build.contains(&format!(
                    "org.springframework.boot' version '{SPRING_BOOT_VERSION}"
                )) || build.contains(&format!("version \"{SPRING_BOOT_VERSION}\""))
            );
            assert!(build.contains("spring-boot-starter-webmvc"));
            assert!(build.contains("spring-boot-starter-test"));
            assert!(build.contains("junit-platform-launcher"));
            assert!(build.contains("options.release = 21"));
            assert!(project.join("gradlew").is_file());
            assert!(project
                .join("src/main/java/com/example/hello/GreetingController.java")
                .is_file());
            assert!(!project.join("build").exists());
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn refuses_spring_boot_layouts_and_java_releases_outside_the_supported_range() {
        for (layout, release, message) in [
            (
                ProjectLayout::MultiModule,
                21,
                "currently supports a single-module project",
            ),
            (ProjectLayout::SingleModule, 27, "requires Java 17 or newer"),
            (ProjectLayout::SingleModule, 11, "requires Java 17 or newer"),
        ] {
            let (root, mut request) = fixture();
            request.framework = ProjectFramework::SpringBootMvc;
            request.layout = layout;
            request.java_release = release;
            let error = create_project_at(&root, &request).unwrap_err();
            assert!(error.contains(message), "{error}");
            assert!(!root.join(&request.artifact_id).exists());
            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    #[cfg(unix)]
    #[ignore = "requires a full JDK 21 and network access for the pinned Maven distribution and build dependencies"]
    fn generated_maven_wrapper_bootstraps_pinned_distribution_and_runs_starter() {
        use std::process::Command;

        struct RemoveFixture(PathBuf);
        impl Drop for RemoveFixture {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }

        let jdk_home = std::env::var("IDE_JAVA_HOME_21")
            .expect("IDE_JAVA_HOME_21 must identify a full JDK 21 installation");
        let (root, mut request) = fixture();
        let _cleanup = RemoveFixture(root.clone());
        request.artifact_id = "maven-wrapper-live".into();
        let project = create_project_at(&root, &request).unwrap();
        let maven_user_home = root.join("isolated-maven-user-home");
        let maven_repository = root.join("isolated-maven-repository");
        let version = Command::new(project.join("mvnw"))
            .arg("--version")
            .env("JAVA_HOME", &jdk_home)
            .env("MAVEN_USER_HOME", &maven_user_home)
            .current_dir(&project)
            .output()
            .expect("generated Maven wrapper must bootstrap its distribution");
        let version_stdout = String::from_utf8_lossy(&version.stdout);
        let version_stderr = String::from_utf8_lossy(&version.stderr);
        assert!(
            version.status.success(),
            "generated Maven wrapper version failed:\n{version_stdout}\n{version_stderr}"
        );
        assert!(
            format!("{version_stdout}\n{version_stderr}").contains("Apache Maven 3.10.0"),
            "wrapper did not run pinned Maven 3.10.0:\n{version_stdout}\n{version_stderr}"
        );
        let maven_repository_option = format!("-Dmaven.repo.local={}", maven_repository.display());
        let output = Command::new(project.join("mvnw"))
            .args([
                "--batch-mode",
                "--no-transfer-progress",
                "-Dstyle.color=never",
                maven_repository_option.as_str(),
                "clean",
                "test",
            ])
            .env("JAVA_HOME", &jdk_home)
            .env("MAVEN_USER_HOME", &maven_user_home)
            .current_dir(&project)
            .output()
            .expect("generated Maven wrapper must start");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            output.status.success(),
            "generated Maven wrapper failed:\n{stdout}\n{stderr}"
        );
        let output_text = format!("{stdout}\n{stderr}");
        assert!(output_text.contains("BUILD SUCCESS"), "{output_text}");

        let distribution_home = maven_user_home.join("wrapper/dists/apache-maven-3.10.0");
        assert!(
            fs::read_dir(distribution_home)
                .unwrap()
                .filter_map(Result::ok)
                .any(|entry| entry.path().join("bin/mvn").is_file()),
            "Maven 3.10.0 was not installed in the isolated wrapper cache"
        );
        let report = fs::read_to_string(
            project.join("target/surefire-reports/TEST-com.example.hello.AppTest.xml"),
        )
        .expect("generated starter must produce a JUnit report");
        assert!(report.contains("tests=\"1\""), "{report}");
        assert!(report.contains("failures=\"0\""), "{report}");
        assert!(report.contains("errors=\"0\""), "{report}");

        let classpath = project
            .join("target/classes")
            .to_string_lossy()
            .into_owned();
        let run = Command::new(Path::new(&jdk_home).join("bin/java"))
            .args(["-cp", classpath.as_str(), "com.example.hello.App"])
            .output()
            .expect("generated Maven application must run");
        let run_stdout = String::from_utf8_lossy(&run.stdout);
        let run_stderr = String::from_utf8_lossy(&run.stderr);
        assert!(run.status.success(), "{run_stdout}\n{run_stderr}");
        assert!(run_stdout.contains("Hello from maven-wrapper-live!"));
    }

    #[cfg(unix)]
    fn assert_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        assert_ne!(fs::metadata(path).unwrap().permissions().mode() & 0o111, 0);
    }

    fn assert_gradle_wrapper_variant(project: &Path, name: &str, version: &str, checksum: &str) {
        let directory = project.join("gradle/wrapper");
        let jar = directory.join(format!("gradle-wrapper-{name}.jar"));
        let properties =
            fs::read_to_string(directory.join(format!("gradle-wrapper-{name}.properties")))
                .unwrap();
        assert!(jar.is_file());
        assert!(properties.contains(&format!("gradle-{version}-bin.zip")));
        assert!(properties.contains(&format!("distributionSha256Sum={checksum}")));
        assert!(properties.contains(&format!(
            "networkTimeout={GRADLE_WRAPPER_NETWORK_TIMEOUT_MS}\n"
        )));
        assert_eq!(
            format!("{:x}", Sha256::digest(fs::read(jar).unwrap())),
            "238e777fcddd7e34f9708186085def2abd6e08e658505b38718d79d74c21abd5"
        );
    }

    #[cfg(unix)]
    fn fixture_command_output(
        command: &mut std::process::Command,
    ) -> std::io::Result<std::process::Output> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
        loop {
            match command.output() {
                // A parallel fork can briefly retain a writer to a new fixture.
                // ETXTBSY occurs before execution; never retry a target exit code.
                Err(error)
                    if error.raw_os_error() == Some(libc::ETXTBSY)
                        && std::time::Instant::now() < deadline =>
                {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                result => return result,
            }
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn wrapper_fixture_waits_for_writer_release_and_never_repeats_target_failures() {
        use std::os::unix::fs::PermissionsExt;
        use std::process::Command;
        let (root, _) = fixture();
        let script = root.join("fixture-launcher");
        let trace = root.join("fixture-launches.txt");
        fs::write(&script, "#!/bin/sh\nprintf 'ran\\n' >> \"$1\"\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        let writer = fs::OpenOptions::new().write(true).open(&script).unwrap();
        let mut command = Command::new(&script);
        command.arg(&trace);
        assert_eq!(
            command.output().unwrap_err().raw_os_error(),
            Some(libc::ETXTBSY)
        );
        let release = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(40));
            drop(writer);
        });
        let output = fixture_command_output(&mut command).unwrap();
        release.join().unwrap();
        assert!(output.status.success());
        assert_eq!(fs::read_to_string(&trace).unwrap(), "ran\n");
        fs::write(&script, "#!/bin/sh\nprintf 'failed\\n' >> \"$1\"\nexit 7\n").unwrap();
        let output = fixture_command_output(&mut command).unwrap();
        assert_eq!(output.status.code(), Some(7));
        assert_eq!(fs::read_to_string(&trace).unwrap(), "ran\nfailed\n");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn gradle_wrapper_selects_distribution_for_the_build_jdk() {
        use std::os::unix::fs::PermissionsExt;
        use std::process::Command;

        let (root, mut request) = fixture();
        request.build_system = BuildSystem::Gradle;
        let project = create_project_at(&root, &request).unwrap();
        let cases = [
            ("1.8.0_432", "gradle-wrapper-java8.jar"),
            ("24.0.2", "gradle-wrapper-java8.jar"),
            ("25.0.1", "gradle-wrapper-java25.jar"),
            ("26.0.1", "gradle-wrapper-java25.jar"),
        ];

        for (index, (version, expected_wrapper)) in cases.into_iter().enumerate() {
            let jdk = root.join(format!("fake-jdk-{index}"));
            fs::create_dir_all(jdk.join("bin")).unwrap();
            let java = jdk.join("bin/java");
            fs::write(
                &java,
                format!(
                    "#!/bin/sh\nif [ \"${{1-}}\" = -version ]; then\n  echo 'openjdk version \"{version}\"' >&2\n  exit 0\nfi\nprintf '%s\\n' \"$*\" >> \"$JAVA_TRACE\"\n"
                ),
            )
            .unwrap();
            fs::set_permissions(&java, fs::Permissions::from_mode(0o755)).unwrap();
            let trace = root.join(format!("java-args-{index}.txt"));
            let output = fixture_command_output(
                Command::new(project.join("gradlew"))
                    .arg("--version")
                    .env("JAVA_HOME", &jdk)
                    .env("JAVA_TRACE", &trace),
            )
            .unwrap();
            assert!(
                output.status.success(),
                "Gradle wrapper launcher failed for JDK {version}: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            let invocation = fs::read_to_string(trace).unwrap();
            assert!(invocation.contains(expected_wrapper), "{invocation}");
        }

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[cfg(unix)]
    #[ignore = "requires full JDK 21 and 25 installations plus network access for pinned Gradle distributions and JUnit artifacts"]
    fn generated_gradle_wrappers_bootstrap_pinned_distributions_and_run_starters() {
        use std::process::Command;

        struct RemoveFixture(PathBuf);
        impl Drop for RemoveFixture {
            fn drop(&mut self) {
                let _ = fs::remove_dir_all(&self.0);
            }
        }

        let jdk_21 = std::env::var("IDE_JAVA_HOME_21")
            .expect("IDE_JAVA_HOME_21 must identify a full JDK 21 installation");
        let jdk_25 = std::env::var("IDE_JAVA_HOME_25")
            .expect("IDE_JAVA_HOME_25 must identify a full JDK 25 installation");
        let (root, mut request) = fixture();
        let _cleanup = RemoveFixture(root.clone());
        let gradle_user_home = root.join("isolated-gradle-user-home");

        for (jdk_major, jdk_home, gradle_version, dsl) in [
            (21, jdk_21, GRADLE_JAVA_8_TO_24_VERSION, GradleDsl::Groovy),
            (25, jdk_25, GRADLE_JAVA_25_PLUS_VERSION, GradleDsl::Kotlin),
        ] {
            let java_version = Command::new(Path::new(&jdk_home).join("bin/java"))
                .arg("-version")
                .output()
                .expect("selected Java runtime must start");
            let java_version = format!(
                "{}\n{}",
                String::from_utf8_lossy(&java_version.stdout),
                String::from_utf8_lossy(&java_version.stderr)
            );
            assert!(
                java_version.contains(&format!("version \"{jdk_major}"))
                    || java_version.contains(&format!("openjdk {jdk_major}")),
                "expected JDK {jdk_major}, observed {java_version}"
            );

            request.build_system = BuildSystem::Gradle;
            request.gradle_dsl = dsl;
            request.artifact_id = format!("gradle-wrapper-jdk-{jdk_major}");
            let project = create_project_at(&root, &request).unwrap();
            let output = Command::new(project.join("gradlew"))
                .args(["--no-daemon", "--console=plain", "clean", "test", "run"])
                .env("JAVA_HOME", &jdk_home)
                .env("GRADLE_USER_HOME", &gradle_user_home)
                .current_dir(&project)
                .output()
                .expect("generated Gradle wrapper must start");
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(
                output.status.success(),
                "JDK {jdk_major} generated wrapper failed:\n{stdout}\n{stderr}"
            );
            let output_text = format!("{stdout}\n{stderr}");
            assert!(
                output_text.contains(&format!("Gradle {gradle_version}")),
                "wrapper did not run pinned Gradle {gradle_version}: {output_text}"
            );
            assert!(
                output_text.contains(&format!("Hello from gradle-wrapper-jdk-{jdk_major}!")),
                "generated application did not run: {output_text}"
            );

            let report = fs::read_to_string(
                project.join("build/test-results/test/TEST-com.example.hello.AppTest.xml"),
            )
            .expect("generated starter must produce a JUnit report");
            assert!(report.contains("tests=\"1\""), "{report}");
            assert!(report.contains("failures=\"0\""), "{report}");
            assert!(report.contains("errors=\"0\""), "{report}");

            let extracted_distribution = gradle_user_home
                .join("wrapper/dists")
                .join(format!("gradle-{gradle_version}-bin"));
            assert!(
                fs::read_dir(extracted_distribution)
                    .unwrap()
                    .filter_map(Result::ok)
                    .any(|entry| {
                        entry
                            .path()
                            .join(format!("gradle-{gradle_version}/bin/gradle"))
                            .is_file()
                    }),
                "Gradle {gradle_version} was not installed in the isolated wrapper cache"
            );
        }
    }

    #[test]
    fn refuses_existing_projects_and_invalid_names_without_modification() {
        let (root, request) = fixture();
        let existing = root.join("hello-java");
        fs::create_dir(&existing).unwrap();
        fs::write(existing.join("keep.txt"), "keep").unwrap();
        assert!(create_project_at(&root, &request).is_err());
        assert_eq!(
            fs::read_to_string(existing.join("keep.txt")).unwrap(),
            "keep"
        );

        let mut invalid = request;
        let escape = format!("{}-escape", root.file_name().unwrap().to_string_lossy());
        invalid.artifact_id = format!("../{escape}");
        assert!(create_project_at(&root, &invalid).is_err());
        assert!(!root.parent().unwrap().join(escape).exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_a_gradle_starter_without_running_build_scripts() {
        let (root, mut request) = fixture();
        request.build_system = BuildSystem::Gradle;
        let project = create_project_at(&root, &request).unwrap();
        let wrapper =
            fs::read_to_string(project.join("gradle/wrapper/gradle-wrapper.properties")).unwrap();
        let build = fs::read_to_string(project.join("build.gradle")).unwrap();
        assert!(project.join("gradlew").is_file());
        assert!(project.join("gradlew.bat").is_file());
        assert!(project.join("gradle/wrapper/gradle-wrapper.jar").is_file());
        assert!(wrapper.contains("gradle-8.14.6-bin.zip"));
        assert!(wrapper.contains(GRADLE_JAVA_8_TO_24_DISTRIBUTION_SHA256));
        assert_gradle_wrapper_variant(
            &project,
            "java8",
            GRADLE_JAVA_8_TO_24_VERSION,
            GRADLE_JAVA_8_TO_24_DISTRIBUTION_SHA256,
        );
        assert_gradle_wrapper_variant(
            &project,
            "java25",
            GRADLE_JAVA_25_PLUS_VERSION,
            GRADLE_JAVA_25_PLUS_DISTRIBUTION_SHA256,
        );
        assert!(fs::read_to_string(project.join("gradlew"))
            .unwrap()
            .contains("gradle-wrapper-java25.jar"));
        assert!(fs::read_to_string(project.join("gradlew.bat"))
            .unwrap()
            .contains("gradle-wrapper-java8.jar"));
        assert_eq!(
            format!("{:x}", Sha256::digest(GRADLE_WRAPPER_JAR)),
            "238e777fcddd7e34f9708186085def2abd6e08e658505b38718d79d74c21abd5"
        );
        #[cfg(unix)]
        assert_executable(&project.join("gradlew"));
        assert!(project.join("settings.gradle").is_file());
        assert!(!project.join("pom.xml").exists());
        assert!(build.contains("options.release = 17"));
        assert!(build.contains("mainClass = 'com.example.hello.App'"));
        assert!(
            build.contains("testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.10.2'")
        );
        assert!(!project.join("pom.xml").exists());
        assert!(project
            .join("src/main/java/com/example/hello/App.java")
            .is_file());
        assert!(project
            .join("src/test/java/com/example/hello/AppTest.java")
            .is_file());
        assert!(fs::read_to_string(project.join(".gitignore"))
            .unwrap()
            .contains(".gradle/"));
        assert!(fs::read_to_string(project.join("README.md"))
            .unwrap()
            .contains("./gradlew test"));
        assert!(!project.join("build").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_a_gradle_kotlin_dsl_starter_without_running_build_scripts() {
        let (root, mut request) = fixture();
        request.build_system = BuildSystem::Gradle;
        request.gradle_dsl = GradleDsl::Kotlin;
        request.java_release = 25;
        let project = create_project_at(&root, &request).unwrap();
        let wrapper =
            fs::read_to_string(project.join("gradle/wrapper/gradle-wrapper.properties")).unwrap();
        let settings = fs::read_to_string(project.join("settings.gradle.kts")).unwrap();
        let build = fs::read_to_string(project.join("build.gradle.kts")).unwrap();
        assert!(!project.join("settings.gradle").exists());
        assert!(!project.join("build.gradle").exists());
        assert!(settings.contains("rootProject.name = \"hello-java\""));
        assert!(build.contains("plugins {\n    application\n}"));
        assert!(build.contains("options.release = 25"));
        assert!(build.contains("mainClass = \"com.example.hello.App\""));
        assert!(build
            .contains("testRuntimeOnly(\"org.junit.platform:junit-platform-launcher:1.10.2\")"));
        assert!(project
            .join("src/main/java/com/example/hello/App.java")
            .is_file());
        assert!(project
            .join("src/test/java/com/example/hello/AppTest.java")
            .is_file());
        assert!(wrapper.contains("gradle-9.8.0-bin.zip"));
        assert!(wrapper.contains(GRADLE_JAVA_25_PLUS_DISTRIBUTION_SHA256));
        assert_gradle_wrapper_variant(
            &project,
            "java8",
            GRADLE_JAVA_8_TO_24_VERSION,
            GRADLE_JAVA_8_TO_24_DISTRIBUTION_SHA256,
        );
        assert_gradle_wrapper_variant(
            &project,
            "java25",
            GRADLE_JAVA_25_PLUS_VERSION,
            GRADLE_JAVA_25_PLUS_DISTRIBUTION_SHA256,
        );
        assert!(fs::read_to_string(project.join("README.md"))
            .unwrap()
            .contains("Gradle Kotlin DSL"));
        assert!(!project.join("build").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_a_maven_application_and_library_reactor_without_build_outputs() {
        let (root, mut request) = fixture();
        request.layout = ProjectLayout::MultiModule;
        let project = create_project_at(&root, &request).unwrap();
        assert!(project.join("mvnw").is_file());
        assert!(!project.join("app/mvnw").exists());
        assert!(!project.join("library/mvnw").exists());
        let parent = fs::read_to_string(project.join("pom.xml")).unwrap();
        let app_pom = fs::read_to_string(project.join("app/pom.xml")).unwrap();
        let app = fs::read_to_string(project.join("app/src/main/java/com/example/hello/App.java"))
            .unwrap();
        assert!(parent.contains("<packaging>pom</packaging>"));
        assert!(parent.contains("<module>library</module>"));
        assert!(parent.contains("<module>app</module>"));
        assert!(app_pom.contains("<artifactId>hello-java-library</artifactId>"));
        assert!(app.contains("return Greeting.message();"));
        assert!(project
            .join("library/src/main/java/com/example/hello/Greeting.java")
            .is_file());
        assert!(project
            .join("app/src/test/java/com/example/hello/AppTest.java")
            .is_file());
        assert!(project
            .join("library/src/test/java/com/example/hello/GreetingTest.java")
            .is_file());
        assert!(!project.join("target").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_a_gradle_application_and_library_build_without_running_it() {
        let (root, mut request) = fixture();
        request.build_system = BuildSystem::Gradle;
        request.layout = ProjectLayout::MultiModule;
        let project = create_project_at(&root, &request).unwrap();
        assert!(project.join("gradlew").is_file());
        assert!(!project.join("app/gradlew").exists());
        assert!(!project.join("library/gradlew").exists());
        let settings = fs::read_to_string(project.join("settings.gradle")).unwrap();
        let build = fs::read_to_string(project.join("build.gradle")).unwrap();
        let app_build = fs::read_to_string(project.join("app/build.gradle")).unwrap();
        let library_build = fs::read_to_string(project.join("library/build.gradle")).unwrap();
        assert!(settings.contains("include 'library', 'app'"));
        assert!(build.contains("options.release = 17"));
        assert!(app_build.contains("implementation project(':library')"));
        assert!(app_build.contains("mainClass = 'com.example.hello.App'"));
        assert!(app_build
            .contains("testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.10.2'"));
        assert!(library_build.contains("id 'java-library'"));
        assert!(library_build
            .contains("testRuntimeOnly 'org.junit.platform:junit-platform-launcher:1.10.2'"));
        assert!(project
            .join("app/src/main/java/com/example/hello/App.java")
            .is_file());
        assert!(project
            .join("library/src/main/java/com/example/hello/Greeting.java")
            .is_file());
        assert!(project
            .join("app/src/test/java/com/example/hello/AppTest.java")
            .is_file());
        assert!(project
            .join("library/src/test/java/com/example/hello/GreetingTest.java")
            .is_file());
        assert!(!project.join("app/build").exists());
        assert!(!project.join("library/build").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_a_gradle_kotlin_dsl_application_and_library_build_without_running_it() {
        let (root, mut request) = fixture();
        request.build_system = BuildSystem::Gradle;
        request.gradle_dsl = GradleDsl::Kotlin;
        request.layout = ProjectLayout::MultiModule;
        let project = create_project_at(&root, &request).unwrap();
        let settings = fs::read_to_string(project.join("settings.gradle.kts")).unwrap();
        let build = fs::read_to_string(project.join("build.gradle.kts")).unwrap();
        let app_build = fs::read_to_string(project.join("app/build.gradle.kts")).unwrap();
        let library_build = fs::read_to_string(project.join("library/build.gradle.kts")).unwrap();
        assert!(!project.join("settings.gradle").exists());
        assert!(!project.join("build.gradle").exists());
        assert!(settings.contains("include(\"library\", \"app\")"));
        assert!(build.contains("tasks.withType<JavaCompile>()"));
        assert!(build.contains("tasks.withType<Test>()"));
        assert!(app_build.contains("implementation(project(\":library\"))"));
        assert!(app_build.contains("mainClass = \"com.example.hello.App\""));
        assert!(app_build
            .contains("testRuntimeOnly(\"org.junit.platform:junit-platform-launcher:1.10.2\")"));
        assert!(library_build.contains("`java-library`"));
        assert!(library_build
            .contains("testRuntimeOnly(\"org.junit.platform:junit-platform-launcher:1.10.2\")"));
        assert!(project
            .join("app/src/main/java/com/example/hello/App.java")
            .is_file());
        assert!(project
            .join("library/src/main/java/com/example/hello/Greeting.java")
            .is_file());
        assert!(project
            .join("app/src/test/java/com/example/hello/AppTest.java")
            .is_file());
        assert!(project
            .join("library/src/test/java/com/example/hello/GreetingTest.java")
            .is_file());
        assert!(fs::read_to_string(project.join("README.md"))
            .unwrap()
            .contains("Gradle Kotlin DSL multi-module project"));
        assert!(!project.join("app/build").exists());
        assert!(!project.join("library/build").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_gradle_dsl_defaults_to_groovy_for_existing_scaffold_requests() {
        let request: CreateRequest = serde_json::from_value(serde_json::json!({
            "workspaceId":"workspace",
            "generation":1,
            "requestId":"request",
            "buildSystem":"gradle",
            "layout":"single-module",
            "artifactId":"hello-java",
            "groupId":"com.example",
            "packageName":"com.example.hello",
            "javaRelease":17
        }))
        .unwrap();
        assert_eq!(request.gradle_dsl, GradleDsl::Groovy);
    }

    #[test]
    #[ignore = "requires JDK 27, Maven, Gradle 9.8.1 and dependency access for generated starter projects"]
    fn generated_java27_starters_build_test_and_run_for_maven_and_gradle_dsls() {
        use std::process::Command;

        fn output(command: &mut Command, label: &str) -> String {
            let result = command
                .output()
                .unwrap_or_else(|error| panic!("{label} could not be started: {error}"));
            let stdout = String::from_utf8_lossy(&result.stdout);
            let stderr = String::from_utf8_lossy(&result.stderr);
            assert!(
                result.status.success(),
                "{label} failed:\n{stdout}\n{stderr}"
            );
            format!("{stdout}\n{stderr}")
        }

        fn assert_java27_class(path: &Path) {
            let class = fs::read(path)
                .unwrap_or_else(|error| panic!("cannot read '{}': {error}", path.display()));
            assert_eq!(class.get(0..4), Some(&[0xca, 0xfe, 0xba, 0xbe][..]));
            assert_eq!(
                u16::from_be_bytes([class[6], class[7]]),
                71,
                "{}",
                path.display()
            );
        }

        let jdk_home = std::env::var("IDE_JAVA27_HOME")
            .expect("IDE_JAVA27_HOME must identify a full JDK 27 installation");
        let java = Path::new(&jdk_home).join("bin/java");
        let java_version = output(&mut Command::new(&java).arg("-version"), "Java version");
        let javac_version = output(
            &mut Command::new(Path::new(&jdk_home).join("bin/javac")).arg("-version"),
            "javac version",
        );
        assert!(java_version.contains("27"), "{java_version}");
        assert!(javac_version.contains("javac 27"), "{javac_version}");
        let gradle_version = output(
            &mut Command::new("gradle").arg("--version"),
            "Gradle version",
        );
        assert!(gradle_version.contains("Gradle 9.8.1"), "{gradle_version}");

        let (root, mut request) = fixture();
        request.java_release = 27;
        let scenarios = [
            (
                "maven-single",
                BuildSystem::Maven,
                GradleDsl::Groovy,
                ProjectLayout::SingleModule,
            ),
            (
                "maven-multi",
                BuildSystem::Maven,
                GradleDsl::Groovy,
                ProjectLayout::MultiModule,
            ),
            (
                "gradle-groovy-single",
                BuildSystem::Gradle,
                GradleDsl::Groovy,
                ProjectLayout::SingleModule,
            ),
            (
                "gradle-kotlin-single",
                BuildSystem::Gradle,
                GradleDsl::Kotlin,
                ProjectLayout::SingleModule,
            ),
            (
                "gradle-groovy-multi",
                BuildSystem::Gradle,
                GradleDsl::Groovy,
                ProjectLayout::MultiModule,
            ),
            (
                "gradle-kotlin-multi",
                BuildSystem::Gradle,
                GradleDsl::Kotlin,
                ProjectLayout::MultiModule,
            ),
        ];
        let mut evidence = Vec::new();
        for (artifact_id, build_system, gradle_dsl, layout) in scenarios {
            request.artifact_id = format!("java27-{artifact_id}");
            request.build_system = build_system;
            request.gradle_dsl = gradle_dsl;
            request.layout = layout;
            let project = create_project_at(&root, &request).unwrap();
            let multi_module = matches!(layout, ProjectLayout::MultiModule);
            let modules: &[&str] = if multi_module {
                &["app", "library"]
            } else {
                &[""]
            };
            let output_text = match build_system {
                BuildSystem::Maven => output(
                    Command::new("mvn")
                        .args(["--batch-mode", "--no-transfer-progress", "test"])
                        .env("JAVA_HOME", &jdk_home)
                        .current_dir(&project),
                    &format!("Maven {artifact_id} test"),
                ),
                BuildSystem::Gradle => {
                    let tasks = if multi_module {
                        vec!["clean", ":library:build", ":app:build", ":app:run"]
                    } else {
                        vec!["clean", "test", "run"]
                    };
                    output(
                        Command::new("gradle")
                            .args(["--no-daemon", "--console=plain"])
                            .args(tasks)
                            .env("JAVA_HOME", &jdk_home)
                            .current_dir(&project),
                        &format!("Gradle {artifact_id} build/test/run"),
                    )
                }
            };
            let runtime_output = if matches!(build_system, BuildSystem::Maven) {
                let mut classpath = Vec::new();
                classpath.push(if multi_module {
                    project.join("app/target/classes")
                } else {
                    project.join("target/classes")
                });
                if multi_module {
                    classpath.push(project.join("library/target/classes"));
                }
                let classpath = std::env::join_paths(classpath).unwrap();
                output(
                    Command::new(&java)
                        .args(["-cp"])
                        .arg(classpath)
                        .arg("com.example.hello.App")
                        .current_dir(&project),
                    &format!("Maven {artifact_id} application"),
                )
            } else {
                output_text.clone()
            };
            assert!(
                runtime_output.contains(&format!("Hello from {}!", request.artifact_id)),
                "{artifact_id}: {runtime_output}"
            );

            for module in modules {
                let module_root = if module.is_empty() {
                    project.clone()
                } else {
                    project.join(module)
                };
                let class_root = match (build_system, multi_module, *module) {
                    (BuildSystem::Maven, false, _) => module_root.join("target/classes"),
                    (BuildSystem::Maven, true, _) => module_root.join("target/classes"),
                    (BuildSystem::Gradle, false, _) => module_root.join("build/classes/java/main"),
                    (BuildSystem::Gradle, true, _) => module_root.join("build/classes/java/main"),
                };
                let source_class = if *module == "library" {
                    class_root.join("com/example/hello/Greeting.class")
                } else {
                    class_root.join("com/example/hello/App.class")
                };
                assert_java27_class(&source_class);
                let test_class = if *module == "library" {
                    "com/example/hello/GreetingTest.class"
                } else {
                    "com/example/hello/AppTest.class"
                };
                assert_java27_class(
                    &module_root
                        .join(match build_system {
                            BuildSystem::Maven => "target/test-classes",
                            BuildSystem::Gradle => "build/classes/java/test",
                        })
                        .join(test_class),
                );
                let report_root = match build_system {
                    BuildSystem::Maven => module_root.join("target/surefire-reports"),
                    BuildSystem::Gradle => module_root.join("build/test-results/test"),
                };
                let report_name = if *module == "library" {
                    "TEST-com.example.hello.GreetingTest.xml"
                } else {
                    "TEST-com.example.hello.AppTest.xml"
                };
                let report =
                    fs::read_to_string(report_root.join(report_name)).unwrap_or_else(|error| {
                        panic!("missing test report for {artifact_id}: {error}")
                    });
                assert!(report.contains("failures=\"0\""), "{report}");
                assert!(report.contains("errors=\"0\""), "{report}");
            }
            evidence.push(serde_json::json!({
                "artifactId": request.artifact_id,
                "buildSystem": match build_system { BuildSystem::Maven => "maven", BuildSystem::Gradle => "gradle" },
                "gradleDsl": match gradle_dsl { GradleDsl::Groovy => "groovy", GradleDsl::Kotlin => "kotlin" },
                "layout": if multi_module { "multi-module" } else { "single-module" },
                "targetRelease": 27,
                "classFileMajor": 71,
                "testModules": modules.len(),
                "applicationRan": true
            }));
        }
        let _ = fs::remove_dir_all(root);
        println!(
            "REAL_JAVA27_SCAFFOLD_BUILD_EVIDENCE={}",
            serde_json::json!({ "selectedJdk": jdk_home, "gradleVersion": gradle_version, "scenarios": evidence })
        );
    }

    #[test]
    #[ignore = "requires installed Gradle and locally cached JUnit artifacts"]
    fn generated_gradle_starter_compiles_and_passes_its_test() {
        use std::process::Command;

        let (root, mut request) = fixture();
        request.build_system = BuildSystem::Gradle;
        let project = create_project_at(&root, &request).unwrap();
        let output = Command::new("gradle")
            .args(["--offline", "test"])
            .current_dir(&project)
            .output()
            .expect("Gradle must be installed for this opt-in check");
        let success = output.status.success();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(root);
        assert!(
            success,
            "Gradle starter build failed:\n{}\n{}",
            stdout, stderr
        );
    }

    #[test]
    #[ignore = "requires installed Gradle and locally cached JUnit artifacts"]
    fn generated_gradle_legacy_starter_sources_compile() {
        use std::process::Command;

        let (root, mut request) = fixture();
        request.build_system = BuildSystem::Gradle;
        let mut failures = Vec::new();
        for release in [8, 11] {
            for dsl in [GradleDsl::Groovy, GradleDsl::Kotlin] {
                request.java_release = release;
                request.gradle_dsl = dsl;
                request.artifact_id = format!(
                    "hello-java-{release}-{}",
                    match dsl {
                        GradleDsl::Groovy => "groovy",
                        GradleDsl::Kotlin => "kotlin",
                    }
                );
                let project = match create_project_at(&root, &request) {
                    Ok(project) => project,
                    Err(error) => {
                        failures.push(format!("Java {release} {dsl:?} scaffold failed: {error}"));
                        continue;
                    }
                };
                match Command::new("gradle")
                    .args(["--offline", "testClasses"])
                    .current_dir(&project)
                    .output()
                {
                    Ok(output) if output.status.success() => {}
                    Ok(output) => failures.push(format!(
                        "Java {release} {dsl:?} source compilation failed:\n{}\n{}",
                        String::from_utf8_lossy(&output.stdout),
                        String::from_utf8_lossy(&output.stderr)
                    )),
                    Err(error) => failures.push(format!(
                        "Java {release} {dsl:?} Gradle invocation failed: {error}"
                    )),
                }
            }
        }
        let _ = fs::remove_dir_all(&root);
        assert!(
            failures.is_empty(),
            "Gradle legacy starter source compilation failed:\n{}",
            failures.join("\n")
        );
    }

    #[test]
    #[ignore = "requires installed Gradle and locally cached JUnit artifacts"]
    fn generated_gradle_legacy_starters_compile_and_pass_their_tests() {
        use std::process::Command;

        let (root, mut request) = fixture();
        request.build_system = BuildSystem::Gradle;
        for release in [8, 11] {
            for dsl in [GradleDsl::Groovy, GradleDsl::Kotlin] {
                request.java_release = release;
                request.gradle_dsl = dsl;
                request.artifact_id = format!(
                    "hello-java-{release}-{}",
                    match dsl {
                        GradleDsl::Groovy => "groovy",
                        GradleDsl::Kotlin => "kotlin",
                    }
                );
                let project = create_project_at(&root, &request).unwrap();
                let output = Command::new("gradle")
                    .args(["--offline", "test"])
                    .current_dir(&project)
                    .output()
                    .expect("Gradle must be installed for this opt-in check");
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                assert!(
                    output.status.success(),
                    "Gradle Java {release} {dsl:?} starter build failed:\n{stdout}\n{stderr}"
                );
            }
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[ignore = "requires installed Gradle and locally cached JUnit artifacts"]
    fn generated_multi_module_gradle_starter_compiles_and_passes_its_tests() {
        use std::process::Command;

        let (root, mut request) = fixture();
        request.build_system = BuildSystem::Gradle;
        request.layout = ProjectLayout::MultiModule;
        let project = create_project_at(&root, &request).unwrap();
        let output = Command::new("gradle")
            .args(["--offline", "test"])
            .current_dir(&project)
            .output()
            .expect("Gradle must be installed for this opt-in check");
        let success = output.status.success();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(root);
        assert!(
            success,
            "Multi-module Gradle starter build failed:\n{}\n{}",
            stdout, stderr
        );
    }

    #[test]
    #[ignore = "requires installed Gradle and locally cached JUnit artifacts"]
    fn generated_gradle_kotlin_dsl_starter_compiles_and_passes_its_test() {
        use std::process::Command;

        let (root, mut request) = fixture();
        request.build_system = BuildSystem::Gradle;
        request.gradle_dsl = GradleDsl::Kotlin;
        let project = create_project_at(&root, &request).unwrap();
        let output = Command::new("gradle")
            .args(["--offline", "test"])
            .current_dir(&project)
            .output()
            .expect("Gradle must be installed for this opt-in check");
        let success = output.status.success();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(root);
        assert!(
            success,
            "Gradle Kotlin DSL starter build failed:\n{}\n{}",
            stdout, stderr
        );
    }

    #[test]
    #[ignore = "requires installed Gradle and locally cached JUnit artifacts"]
    fn generated_multi_module_gradle_kotlin_dsl_starter_compiles_and_passes_its_tests() {
        use std::process::Command;

        let (root, mut request) = fixture();
        request.build_system = BuildSystem::Gradle;
        request.gradle_dsl = GradleDsl::Kotlin;
        request.layout = ProjectLayout::MultiModule;
        let project = create_project_at(&root, &request).unwrap();
        let output = Command::new("gradle")
            .args(["--offline", "test"])
            .current_dir(&project)
            .output()
            .expect("Gradle must be installed for this opt-in check");
        let success = output.status.success();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(root);
        assert!(
            success,
            "Multi-module Gradle Kotlin DSL starter build failed:\n{}\n{}",
            stdout, stderr
        );
    }

    #[test]
    #[ignore = "requires installed Maven and locally cached Maven/JUnit artifacts"]
    fn generated_multi_module_maven_starter_compiles_and_passes_its_tests() {
        use std::process::Command;

        let (root, mut request) = fixture();
        request.layout = ProjectLayout::MultiModule;
        let project = create_project_at(&root, &request).unwrap();
        let output = Command::new("mvn")
            .args([
                "--batch-mode",
                "--offline",
                "--no-transfer-progress",
                "test",
            ])
            .current_dir(&project)
            .output()
            .expect("Maven must be installed for this opt-in check");
        let success = output.status.success();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let _ = fs::remove_dir_all(root);
        assert!(
            success,
            "Multi-module Maven starter build failed:\n{}\n{}",
            stdout, stderr
        );
    }

    #[test]
    fn creates_maven_and_gradle_starters_for_supported_java_releases() {
        let (root, mut request) = fixture();
        for release in [8, 11, 17, 21, 25, 26, 27] {
            request.java_release = release;
            request.build_system = BuildSystem::Maven;
            request.artifact_id = format!("maven-java-{release}");
            let maven = create_project_at(&root, &request).unwrap();
            assert!(fs::read_to_string(maven.join("pom.xml"))
                .unwrap()
                .contains(&format!(
                    "<maven.compiler.release>{release}</maven.compiler.release>"
                )));

            request.build_system = BuildSystem::Gradle;
            request.gradle_dsl = GradleDsl::Groovy;
            request.artifact_id = format!("gradle-java-{release}");
            let gradle = create_project_at(&root, &request).unwrap();
            assert!(fs::read_to_string(gradle.join("build.gradle"))
                .unwrap()
                .contains(&format!("options.release = {release}")));
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_java_keywords_and_unsupported_releases() {
        let (root, mut request) = fixture();
        request.package_name = "com.example.class".into();
        assert!(create_project_at(&root, &request).is_err());
        request.package_name = "com.example.ok".into();
        request.java_release = 28;
        assert!(create_project_at(&root, &request).is_err());
        assert!(!root.join("hello-java").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[ignore = "requires installed Maven and locally cached Maven/JUnit artifacts"]
    fn generated_maven_starter_compiles_and_passes_its_test() {
        use std::process::Command;

        let (root, mut request) = fixture();
        for release in [8, 11] {
            request.java_release = release;
            request.artifact_id = format!("hello-java-{release}");
            let project = create_project_at(&root, &request).unwrap();
            let output = Command::new("mvn")
                .args([
                    "--batch-mode",
                    "--offline",
                    "--no-transfer-progress",
                    "test",
                ])
                .current_dir(&project)
                .output()
                .expect("Maven must be installed for this opt-in check");
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(
                output.status.success(),
                "Maven Java {release} starter build failed:\n{stdout}\n{stderr}"
            );
        }
        let _ = fs::remove_dir_all(root);
    }
}
