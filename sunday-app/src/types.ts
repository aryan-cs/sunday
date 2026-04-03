export interface CalendarEvent {
  id: string;
  title: string;
  location: string | null;
  start_iso: string;
  end_iso: string;
  travel_minutes: number | null;
  travel_mode: string | null;
  leave_by_iso: string | null;
  is_online: boolean;
  meeting_link: string | null;
}
