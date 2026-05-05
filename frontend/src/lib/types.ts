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
  images?: Array<{
    id: string;
    image_index: number;
    image_mime_type: string;
    image_size_bytes: number;
  }>;
};

export type CaseListResponse = {
  cases: Case[];
  total: number;
  limit: number;
  offset: number;
};

export type UserStats = {
  total_cases: number;
  violations_confirmed: number;
  violations_not_confirmed: number;
  status_completed: number;
  status_reported: number;
  status_resolved: number;
  status_cancelled: number;
  avg_confidence: string | null;
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
  caseId: string;
  userId: string;
  status: string;
  imageCount: number;
  analysis: {
    violationConfirmed: boolean;
    violationType: string | null;
    confidence: number;
    explanation: string;
  };
  createdAt: string;
};

export type AuthResponse = {
  user: {
    id: string;
    email: string;
    role?: "citizen" | "admin";
    firstName?: string | null;
    lastName?: string | null;
    emailVerified?: boolean;
  };
  token: string;
  refreshToken: string;
};

export type CaseImage = {
  id: string;
  case_id: string;
  image_index: number;
  image_mime_type: string;
  image_size_bytes: number;
  created_at: string;
};
