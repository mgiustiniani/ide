import type {
  JavaDatabaseConnectionInput,
  JavaDatabaseEstimatedPlanResult,
  JavaDatabaseResultExportRequest,
  JavaDatabaseResultExport,
  JavaDatabaseCancelRequest,
  JavaDatabaseCancelResult,
  JavaDatabaseConnectionResult,
  JavaDatabaseQueryResult,
  JavaDatabaseQuerySubmission,
  JavaDatabaseSessionScope,
  JavaDatabaseSessionConnectionResult,
  JavaDatabaseSessionQueryRequest,
  JavaDatabaseSessionQueryResult,
  JavaDatabaseTransactionRequest,
  JavaDatabaseTransactionResult,
  JavaDatabaseSessionCloseRequest,
  JavaDatabaseSessionCloseResult,
} from "@ide/contracts";

export interface JavaDatabasePort {
  explainSession?(
    request: JavaDatabaseSessionQueryRequest,
  ): Promise<JavaDatabaseEstimatedPlanResult>;
  exportResult?(request: JavaDatabaseResultExportRequest): Promise<JavaDatabaseResultExport | null>;
  cancelSession?(request: JavaDatabaseCancelRequest): Promise<JavaDatabaseCancelResult>;
  connectSession?(
    request: JavaDatabaseConnectionInput,
  ): Promise<JavaDatabaseSessionConnectionResult>;
  inspectSession?(request: JavaDatabaseSessionScope): Promise<JavaDatabaseSessionConnectionResult>;
  executeSession?(
    request: JavaDatabaseSessionQueryRequest,
  ): Promise<JavaDatabaseSessionQueryResult>;
  controlSession?(request: JavaDatabaseTransactionRequest): Promise<JavaDatabaseTransactionResult>;
  closeSession?(request: JavaDatabaseSessionCloseRequest): Promise<JavaDatabaseSessionCloseResult>;
  inspect(request: JavaDatabaseConnectionInput): Promise<JavaDatabaseConnectionResult>;
  execute(request: JavaDatabaseQuerySubmission): Promise<JavaDatabaseQueryResult>;
}
