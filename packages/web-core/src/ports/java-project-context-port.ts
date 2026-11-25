import type {
  JavaProjectContextAuthority,
  JavaProjectLanguageSettingsRequest,
  JavaProjectLanguageSettingsResult,
  JavaProjectContextRequest,
  JavaProjectContextResult,
  JavaSavedSourceRecoveryRequest,
} from "@ide/contracts";

/** RefactorKit owns project discovery and the analysis environment. */
export interface JavaProjectContextPort {
  query(request: JavaProjectContextRequest): Promise<JavaProjectContextResult>;
  recoverSavedSources?(request: JavaSavedSourceRecoveryRequest): Promise<void>;
  stop(authority: JavaProjectContextAuthority): Promise<void>;
  applyLanguageSettings?(
    request: JavaProjectLanguageSettingsRequest,
  ): Promise<JavaProjectLanguageSettingsResult>;
  clearLanguageSettings?(authority: JavaProjectContextAuthority): Promise<void>;
  watch?(
    authority: JavaProjectContextAuthority,
    projectPath: string,
    watchId: string,
    listener: (event: JavaProjectContextChangeEvent) => void,
  ): Promise<() => void | Promise<void>>;
}

export interface JavaProjectContextChangeEvent extends JavaProjectContextAuthority {
  projectPath: string;
  watchId: string;
  status: "changed" | "unavailable";
  /** Native file monitoring classifies the changed input; older events remain manual. */
  changeKind?: "source" | "buildConfiguration";
}

/** A provider operation explicitly retired its selected Java project session. */
export class JavaProjectContextRetiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JavaProjectContextRetiredError";
  }
}
