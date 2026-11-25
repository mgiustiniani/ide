import type { JavaProjectTextSearchRequest, JavaProjectTextSearchResult } from "@ide/contracts";

export interface JavaProjectTextSearchPort {
  search(request: JavaProjectTextSearchRequest): Promise<JavaProjectTextSearchResult>;
}
