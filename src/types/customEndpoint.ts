export type CustomEndpointApprovalOutcome =
  | { status: "approved"; endpoint: string }
  | { status: "cancelled" | "invalid" | "error" | "superseded"; message: string };

export type CustomEndpointSetterResult = void | string | null | CustomEndpointApprovalOutcome;

export type CustomEndpointSetter = (
  value: string
) => CustomEndpointSetterResult | Promise<CustomEndpointSetterResult>;

export const normalizeCustomEndpointOutcome = (
  result: CustomEndpointSetterResult,
  requestedEndpoint: string
): CustomEndpointApprovalOutcome => {
  if (result && typeof result === "object" && "status" in result) {
    return result;
  }
  if (result === null) {
    return {
      status: "cancelled",
      message: "Endpoint approval was cancelled. Your previous endpoint is unchanged.",
    };
  }
  return {
    status: "approved",
    endpoint: typeof result === "string" ? result : requestedEndpoint,
  };
};
