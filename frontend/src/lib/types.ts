export type Case = {
  id: string;
  user_id: string;
  status: "pending" | "completed" | "reported_to_authority" | "resolved" | "cancelled";
  violation_confirmed: boolean | null;
  violation_type: string | null;
  confidence: number | null;
  explanation: string | null;
  image_mime_type: string | null;
  image_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type CaseListResponse = {
  cases: Case[];
  total: number;
  limit: number;
  offset: number;
};

export type UserStats = {
  total: number;
  completed: number;
  confirmed: number;
  reported: number;
  resolved: number;
};

export type Notification = {
  id: string;
  case_id: string;
  user_id: string;
  notification_type: string;
  message: string;
  status: string;
  is_read: boolean;
  created_at: string;
};

export type NotificationPreferences = {
  user_id: string;
  in_app: boolean;
  sms: boolean;
  email: boolean;
  push: boolean;
  phone: string | null;
  email_addr: string | null;
  fcm_token: string | null;
};

export type AnalyzeResponse = {
  case: Case;
};

export type AuthResponse = {
  user: { id: string; email: string };
  token: string;
  refreshToken: string;
};
