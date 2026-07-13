export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
      announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: number
          published_at: string | null
          status: Database['public']['Enums']['announcement_status']
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: never
          published_at?: string | null
          status?: Database['public']['Enums']['announcement_status']
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: never
          published_at?: string | null
          status?: Database['public']['Enums']['announcement_status']
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          after_data: Json | null
          before_data: Json | null
          created_at: string
          id: number
          metadata: Json
          target_id: string | null
          target_table: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: never
          metadata?: Json
          target_id?: string | null
          target_table: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: never
          metadata?: Json
          target_id?: string | null
          target_table?: string
        }
        Relationships: []
      }
      platform_accounts: {
        Row: {
          created_at: string
          external_id: string
          id: number
          normalized_external_id: string
          platform: Database['public']['Enums']['platform_name']
          profile_id: string
          status: Database['public']['Enums']['account_verification_status']
          updated_at: string
          verification_error_code: Database['public']['Enums']['sync_error_code'] | null
          verification_error_message: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          external_id: string
          id?: never
          normalized_external_id: string
          platform: Database['public']['Enums']['platform_name']
          profile_id: string
          status?: Database['public']['Enums']['account_verification_status']
          updated_at?: string
          verification_error_code?: Database['public']['Enums']['sync_error_code'] | null
          verification_error_message?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          external_id?: string
          id?: never
          normalized_external_id?: string
          platform?: Database['public']['Enums']['platform_name']
          profile_id?: string
          status?: Database['public']['Enums']['account_verification_status']
          updated_at?: string
          verification_error_code?: Database['public']['Enums']['sync_error_code'] | null
          verification_error_message?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'platform_accounts_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'platform_accounts_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'public_members'
            referencedColumns: ['id']
          },
        ]
      }
      platform_stats: {
        Row: {
          current_rating: number | null
          error_code: Database['public']['Enums']['sync_error_code'] | null
          error_message: string | null
          fetched_at: string
          last_success_at: string | null
          max_rating: number | null
          platform: Database['public']['Enums']['platform_name']
          profile_id: string
          solved_count: number | null
          source_observed_at: string | null
          source_version: string | null
          stale_after: string | null
          status: Database['public']['Enums']['stat_freshness_status']
          updated_at: string
        }
        Insert: {
          current_rating?: number | null
          error_code?: Database['public']['Enums']['sync_error_code'] | null
          error_message?: string | null
          fetched_at?: string
          last_success_at?: string | null
          max_rating?: number | null
          platform: Database['public']['Enums']['platform_name']
          profile_id: string
          solved_count?: number | null
          source_observed_at?: string | null
          source_version?: string | null
          stale_after?: string | null
          status?: Database['public']['Enums']['stat_freshness_status']
          updated_at?: string
        }
        Update: {
          current_rating?: number | null
          error_code?: Database['public']['Enums']['sync_error_code'] | null
          error_message?: string | null
          fetched_at?: string
          last_success_at?: string | null
          max_rating?: number | null
          platform?: Database['public']['Enums']['platform_name']
          profile_id?: string
          solved_count?: number | null
          source_observed_at?: string | null
          source_version?: string | null
          stale_after?: string | null
          status?: Database['public']['Enums']['stat_freshness_status']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'platform_stats_account_fkey'
            columns: ['profile_id', 'platform']
            isOneToOne: true
            referencedRelation: 'platform_accounts'
            referencedColumns: ['profile_id', 'platform']
          },
          {
            foreignKeyName: 'platform_stats_account_fkey'
            columns: ['profile_id', 'platform']
            isOneToOne: true
            referencedRelation: 'public_platform_accounts'
            referencedColumns: ['profile_id', 'platform']
          },
        ]
      }
      profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          full_name: string | null
          grade: string | null
          id: string
          is_public: boolean
          major: string | null
          qq: string | null
          review_note: string | null
          review_requested_at: string
          review_status: Database['public']['Enums']['profile_review_status']
          role: Database['public']['Enums']['app_role']
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          full_name?: string | null
          grade?: string | null
          id: string
          is_public?: boolean
          major?: string | null
          qq?: string | null
          review_note?: string | null
          review_requested_at?: string
          review_status?: Database['public']['Enums']['profile_review_status']
          role?: Database['public']['Enums']['app_role']
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          full_name?: string | null
          grade?: string | null
          id?: string
          is_public?: boolean
          major?: string | null
          qq?: string | null
          review_note?: string | null
          review_requested_at?: string
          review_status?: Database['public']['Enums']['profile_review_status']
          role?: Database['public']['Enums']['app_role']
          updated_at?: string
        }
        Relationships: []
      }
      stat_snapshots: {
        Row: {
          current_rating: number | null
          id: number
          max_rating: number | null
          platform: Database['public']['Enums']['platform_name']
          profile_id: string
          recorded_at: string
          solved_count: number | null
          source_observed_at: string | null
          status: Database['public']['Enums']['stat_freshness_status']
          sync_run_id: number
        }
        Insert: {
          current_rating?: number | null
          id?: never
          max_rating?: number | null
          platform: Database['public']['Enums']['platform_name']
          profile_id: string
          recorded_at?: string
          solved_count?: number | null
          source_observed_at?: string | null
          status: Database['public']['Enums']['stat_freshness_status']
          sync_run_id: number
        }
        Update: {
          current_rating?: number | null
          id?: never
          max_rating?: number | null
          platform?: Database['public']['Enums']['platform_name']
          profile_id?: string
          recorded_at?: string
          solved_count?: number | null
          source_observed_at?: string | null
          status?: Database['public']['Enums']['stat_freshness_status']
          sync_run_id?: number
        }
        Relationships: [
          {
            foreignKeyName: 'stat_snapshots_account_fkey'
            columns: ['profile_id', 'platform']
            isOneToOne: false
            referencedRelation: 'platform_accounts'
            referencedColumns: ['profile_id', 'platform']
          },
          {
            foreignKeyName: 'stat_snapshots_account_fkey'
            columns: ['profile_id', 'platform']
            isOneToOne: false
            referencedRelation: 'public_platform_accounts'
            referencedColumns: ['profile_id', 'platform']
          },
          {
            foreignKeyName: 'stat_snapshots_sync_run_id_fkey'
            columns: ['sync_run_id']
            isOneToOne: false
            referencedRelation: 'sync_runs'
            referencedColumns: ['id']
          },
        ]
      }
      sync_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          dedupe_key: string | null
          finished_at: string | null
          id: number
          last_error_code: Database['public']['Enums']['sync_error_code'] | null
          last_error_message: string | null
          max_attempts: number
          payload: Json
          platform: Database['public']['Enums']['platform_name'] | null
          priority: number
          profile_id: string | null
          requested_by: string | null
          scheduled_for: string
          scope: Database['public']['Enums']['sync_job_scope']
          started_at: string | null
          status: Database['public']['Enums']['sync_job_status']
          trigger_type: Database['public']['Enums']['sync_trigger_type']
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          dedupe_key?: string | null
          finished_at?: string | null
          id?: never
          last_error_code?: Database['public']['Enums']['sync_error_code'] | null
          last_error_message?: string | null
          max_attempts?: number
          payload?: Json
          platform?: Database['public']['Enums']['platform_name'] | null
          priority?: number
          profile_id?: string | null
          requested_by?: string | null
          scheduled_for?: string
          scope: Database['public']['Enums']['sync_job_scope']
          started_at?: string | null
          status?: Database['public']['Enums']['sync_job_status']
          trigger_type: Database['public']['Enums']['sync_trigger_type']
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          dedupe_key?: string | null
          finished_at?: string | null
          id?: never
          last_error_code?: Database['public']['Enums']['sync_error_code'] | null
          last_error_message?: string | null
          max_attempts?: number
          payload?: Json
          platform?: Database['public']['Enums']['platform_name'] | null
          priority?: number
          profile_id?: string | null
          requested_by?: string | null
          scheduled_for?: string
          scope?: Database['public']['Enums']['sync_job_scope']
          started_at?: string | null
          status?: Database['public']['Enums']['sync_job_status']
          trigger_type?: Database['public']['Enums']['sync_trigger_type']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sync_jobs_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sync_jobs_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'public_members'
            referencedColumns: ['id']
          },
        ]
      }
      sync_runs: {
        Row: {
          attempt: number
          duration_ms: number | null
          error_code: Database['public']['Enums']['sync_error_code'] | null
          error_message: string | null
          finished_at: string | null
          http_status: number | null
          id: number
          job_id: number
          metrics: Json | null
          platform: Database['public']['Enums']['platform_name']
          platform_account_id: number | null
          profile_id: string
          source_version: string | null
          started_at: string
          status: Database['public']['Enums']['sync_run_status']
        }
        Insert: {
          attempt?: number
          duration_ms?: number | null
          error_code?: Database['public']['Enums']['sync_error_code'] | null
          error_message?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: never
          job_id: number
          metrics?: Json | null
          platform: Database['public']['Enums']['platform_name']
          platform_account_id?: number | null
          profile_id: string
          source_version?: string | null
          started_at?: string
          status?: Database['public']['Enums']['sync_run_status']
        }
        Update: {
          attempt?: number
          duration_ms?: number | null
          error_code?: Database['public']['Enums']['sync_error_code'] | null
          error_message?: string | null
          finished_at?: string | null
          http_status?: number | null
          id?: never
          job_id?: number
          metrics?: Json | null
          platform?: Database['public']['Enums']['platform_name']
          platform_account_id?: number | null
          profile_id?: string
          source_version?: string | null
          started_at?: string
          status?: Database['public']['Enums']['sync_run_status']
        }
        Relationships: [
          {
            foreignKeyName: 'sync_runs_job_id_fkey'
            columns: ['job_id']
            isOneToOne: false
            referencedRelation: 'sync_jobs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sync_runs_platform_account_id_fkey'
            columns: ['platform_account_id']
            isOneToOne: false
            referencedRelation: 'platform_accounts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sync_runs_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sync_runs_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'public_members'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      public_announcements: {
        Row: {
          body: string | null
          created_at: string | null
          expires_at: string | null
          id: number | null
          published_at: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: number | null
          published_at?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: number | null
          published_at?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      public_members: {
        Row: {
          created_at: string | null
          full_name: string | null
          grade: string | null
          id: string | null
          major: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          full_name?: string | null
          grade?: string | null
          id?: string | null
          major?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          full_name?: string | null
          grade?: string | null
          id?: string | null
          major?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      public_platform_accounts: {
        Row: {
          external_id: string | null
          platform: Database['public']['Enums']['platform_name'] | null
          profile_id: string | null
          verified_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'platform_accounts_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'platform_accounts_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'public_members'
            referencedColumns: ['id']
          },
        ]
      }
      public_platform_stats: {
        Row: {
          current_rating: number | null
          error_code: Database['public']['Enums']['sync_error_code'] | null
          fetched_at: string | null
          last_success_at: string | null
          max_rating: number | null
          platform: Database['public']['Enums']['platform_name'] | null
          profile_id: string | null
          solved_count: number | null
          source_observed_at: string | null
          source_version: string | null
          stale_after: string | null
          status: Database['public']['Enums']['stat_freshness_status'] | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'platform_stats_account_fkey'
            columns: ['profile_id', 'platform']
            isOneToOne: true
            referencedRelation: 'platform_accounts'
            referencedColumns: ['profile_id', 'platform']
          },
          {
            foreignKeyName: 'platform_stats_account_fkey'
            columns: ['profile_id', 'platform']
            isOneToOne: true
            referencedRelation: 'public_platform_accounts'
            referencedColumns: ['profile_id', 'platform']
          },
        ]
      }
      public_stat_snapshots: {
        Row: {
          current_rating: number | null
          id: number | null
          max_rating: number | null
          platform: Database['public']['Enums']['platform_name'] | null
          profile_id: string | null
          recorded_at: string | null
          solved_count: number | null
          source_observed_at: string | null
          status: Database['public']['Enums']['stat_freshness_status'] | null
        }
        Relationships: [
          {
            foreignKeyName: 'stat_snapshots_account_fkey'
            columns: ['profile_id', 'platform']
            isOneToOne: false
            referencedRelation: 'platform_accounts'
            referencedColumns: ['profile_id', 'platform']
          },
          {
            foreignKeyName: 'stat_snapshots_account_fkey'
            columns: ['profile_id', 'platform']
            isOneToOne: false
            referencedRelation: 'public_platform_accounts'
            referencedColumns: ['profile_id', 'platform']
          },
        ]
      }
    }
    Functions: {
      admin_get_overview: {
        Args: never
        Returns: {
          approved_member_count: number
          credential_error_count: number
          failed_job_count_24h: number
          overdue_stat_count: number
          pending_member_count: number
          running_job_count: number
          verified_account_count: number
        }[]
      }
      admin_get_source_health: {
        Args: { lookback_hours?: number }
        Returns: {
          average_duration_ms: number
          failed_runs: number
          last_failure_at: string
          last_success_at: string
          latest_error_code: Database['public']['Enums']['sync_error_code']
          platform: Database['public']['Enums']['platform_name']
          succeeded_runs: number
          success_rate: number
          total_runs: number
        }[]
      }
      admin_list_audit_logs: {
        Args: { before_log_id?: number; row_limit?: number }
        Returns: {
          action: string
          actor_id: string
          actor_label: string
          created_at: string
          details: Json
          id: number
          target_id: string
          target_label: string
          target_table: string
        }[]
      }
      admin_list_platform_accounts: {
        Args: never
        Returns: {
          email: string
          external_id: string
          full_name: string
          id: number
          major: string
          platform: Database['public']['Enums']['platform_name']
          profile_id: string
          status: Database['public']['Enums']['account_verification_status']
          updated_at: string
          verification_error_code: Database['public']['Enums']['sync_error_code']
          verification_error_message: string
          verified_at: string
        }[]
      }
      admin_list_members: {
        Args: never
        Returns: {
          created_at: string
          email: string
          full_name: string
          grade: string
          id: string
          is_public: boolean
          major: string
          platform_count: number
          qq: string
          review_status: Database['public']['Enums']['profile_review_status']
          suspension_note: string
          updated_at: string
          verified_platform_count: number
        }[]
      }
      admin_list_sync_runs: {
        Args: { before_run_id?: number; row_limit?: number }
        Returns: {
          duration_ms: number
          error_code: Database['public']['Enums']['sync_error_code']
          error_message: string
          finished_at: string
          job_id: number
          job_status: Database['public']['Enums']['sync_job_status']
          member_name: string
          platform: Database['public']['Enums']['platform_name']
          profile_id: string
          requested_by: string
          run_id: number
          run_status: Database['public']['Enums']['sync_run_status']
          source_version: string
          started_at: string
          trigger_type: Database['public']['Enums']['sync_trigger_type']
        }[]
      }
      admin_set_platform_account_status: {
        Args: {
          error_message: string
          expected_updated_at: string
          next_status: Database['public']['Enums']['account_verification_status']
          target_account_id: number
        }
        Returns: Database['public']['Enums']['account_verification_status']
      }
      admin_set_member_suspension: {
        Args: {
          expected_updated_at: string
          note?: string
          suspended: boolean
          target_profile_id: string
        }
        Returns: string
      }
      bootstrap_first_admin: { Args: { target_email: string }; Returns: string }
      can_edit_own_data: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      account_verification_status: 'pending' | 'verified' | 'invalid' | 'disabled'
      announcement_status: 'draft' | 'published' | 'archived'
      app_role: 'member' | 'admin'
      platform_name: 'codeforces' | 'nowcoder' | 'atcoder' | 'xcpc_elo' | 'luogu' | 'qoj'
      profile_review_status: 'pending' | 'approved' | 'rejected' | 'suspended'
      stat_freshness_status: 'fresh' | 'stale' | 'unavailable'
      sync_error_code:
        | 'not_found'
        | 'auth_required'
        | 'auth_expired'
        | 'rate_limited'
        | 'schema_changed'
        | 'timeout'
        | 'network_error'
        | 'invalid_response'
        | 'invalid_account'
        | 'external_worker_required'
        | 'not_configured'
        | 'source_unavailable'
        | 'upstream_error'
        | 'unknown'
      sync_job_scope: 'account' | 'member' | 'platform' | 'all'
      sync_job_status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
      sync_run_status: 'running' | 'succeeded' | 'failed' | 'skipped'
      sync_trigger_type: 'scheduled' | 'manual' | 'registration' | 'account_changed' | 'retry'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_verification_status: ['pending', 'verified', 'invalid', 'disabled'],
      announcement_status: ['draft', 'published', 'archived'],
      app_role: ['member', 'admin'],
      platform_name: ['codeforces', 'nowcoder', 'atcoder', 'xcpc_elo', 'luogu', 'qoj'],
      profile_review_status: ['pending', 'approved', 'rejected', 'suspended'],
      stat_freshness_status: ['fresh', 'stale', 'unavailable'],
      sync_error_code: [
        'not_found',
        'auth_required',
        'auth_expired',
        'rate_limited',
        'schema_changed',
        'timeout',
        'network_error',
        'invalid_response',
        'invalid_account',
        'external_worker_required',
        'not_configured',
        'source_unavailable',
        'upstream_error',
        'unknown',
      ],
      sync_job_scope: ['account', 'member', 'platform', 'all'],
      sync_job_status: ['queued', 'running', 'succeeded', 'failed', 'cancelled'],
      sync_run_status: ['running', 'succeeded', 'failed', 'skipped'],
      sync_trigger_type: ['scheduled', 'manual', 'registration', 'account_changed', 'retry'],
    },
  },
} as const
