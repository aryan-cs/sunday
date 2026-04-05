export type AlertEntry = {
  id: string;
  summary: string;
  transcript: string;
  createdAt: string;
  status: "pending" | "complete" | "failed";
  audioUri?: string | null;
};
