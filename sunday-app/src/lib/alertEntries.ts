export type CalendarEventAction = {
  type: "calendar_event";
  title: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  is_online: boolean | null;
  description: string | null;
  executed: boolean;
  conflict: boolean;
  conflict_with: string | null;
};

export type ReminderAction = {
  type: "reminder";
  task: string;
  deadline: string | null;
  priority: string;
  executed: boolean;
};

export type SocialInsightAction = {
  type: "social_insight";
  person: string;
  insight: string;
  category: string;
};

export type PreparationAction = {
  type: "preparation";
  topic: string;
  suggestion: string;
};

export type ResearchAction = {
  type: "research";
  title: string;
  url: string;
  snippet: string | null;
  source: string;
};

export type SendMessageAction = {
  type: "send_message";
  recipient_name: string;
  message: string;
  phone: string | null;
  executed: boolean;
};

export type ActionItem =
  | CalendarEventAction
  | ReminderAction
  | SocialInsightAction
  | PreparationAction
  | ResearchAction
  | SendMessageAction;

export type AlertEntry = {
  id: string;
  summary: string;
  transcript: string;
  createdAt: string;
  status: "pending" | "complete" | "failed";
  audioUri?: string | null;
  actions?: ActionItem[];
};
