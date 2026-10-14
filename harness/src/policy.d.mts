export type RestrictedActionName =
  | "production_deploy" | "merge_to_main" | "push_remote" | "authentication"
  | "account_connection" | "destructive_infra" | "credential_access" | "real_phi_access" | "modify_acceptance_criteria";
export function checkCommand(command: string): { restricted: RestrictedActionName | null; reason: string };
