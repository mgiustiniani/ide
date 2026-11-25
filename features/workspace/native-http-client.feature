@REQ-IDE-HTTP-CLIENT-001 @partial @desktop @native-gui @functional-requirement @e2e @http-client-native
Feature: Send HTTP requests from the IDE
  Java developers can exercise a locally running HTTP service without leaving the IDE.
  Requests are sent only after explicit submission, response bodies are bounded, and the request
  editor does not write workspace files. Explicit collection export creates only the selected new JSON file.

  Scenario: Send a JSON request to a local service and inspect its response
    Given the native HTTP client has an isolated workspace and local API service
    When the person sends a JSON request to the local API service
    Then the IDE shows the service response
    When the person closes the HTTP client IDE window
    Then the HTTP client and local service exit cleanly and the workspace remains unchanged

  Scenario: Prepare declared OpenAPI parameters and review the request before sending
    Given the native HTTP client has an isolated workspace and local API service
    When the person loads an OpenAPI route and sends the selected request
    Then the IDE shows the service response
    When the person closes the HTTP client IDE window
    Then the HTTP client and local service exit cleanly and the workspace remains unchanged

  Scenario: Transfer collections through workspace files and native Save As, then restore templates after restart
    Given the native HTTP client has an isolated workspace and local API service
    When the person saves a request and environment, restarts the IDE and sends the restored template
    Then the IDE shows the service response
    When the person closes the HTTP client IDE window
    Then the HTTP client and local service exit cleanly with only the explicitly exported collection file changed

  Scenario: Send explicit Basic and Bearer credentials without saving them in a collection
    Given the native HTTP client has an isolated workspace and local API service
    When the person sends Basic and Bearer requests and reloads a saved request without credentials
    Then the IDE shows the service response
    When the person closes the HTTP client IDE window
    Then the HTTP client and local service exit cleanly and the workspace remains unchanged

  @http-request-files
  Scenario: Send the unsaved HTTP file buffer and refuse unsupported script requests
    Given the native HTTP client has an isolated workspace and local API service
    When the person edits an HTTP file and explicitly sends its buffer request
    Then the IDE shows the service response
    When the person closes the HTTP client IDE window
    Then the HTTP client and local service exit cleanly and the workspace remains unchanged

  @http-oauth-browser
  Scenario: Approve browser consent, use the token explicitly, and recover from cancelled or refused authorization
    Given the native OAuth tool has an isolated workspace and authorization service
    When the person approves OAuth consent in the external browser and sends a protected request
    Then the native OAuth exchange preserves PKCE and requires explicit token use
    When the person cancels browser sign-in and rejects denied or mismatched issuer responses
    Then refused OAuth responses do not exchange or use another token
    When the person closes the OAuth IDE window
    Then the OAuth IDE and owned browser fixture exit cleanly without changing workspace files
