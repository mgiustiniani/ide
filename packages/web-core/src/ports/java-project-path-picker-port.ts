/** Native filesystem selection for Java project settings. */
export interface JavaProjectPathPickerPort {
  selectDirectory(defaultPath?: string): Promise<string | null>;
  selectFile(): Promise<string | null>;
}
