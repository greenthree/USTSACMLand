export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
      admin_rate_limit_buckets: {
        Row: {
          action_key: string
          actor_id: string
          request_count: number
          updated_at: string
          window_started_at: string
        }
        Insert: {
          action_key: string
          actor_id: string
          request_count: number
          updated_at?: string
          window_started_at: string
        }
        Update: {
          action_key?: string
          actor_id?: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'admin_rate_limit_buckets_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
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
      luogu_sync_states: {
        Row: {
          account_external_id: string
          boundary_record_id: string | null
          boundary_submit_time: number | null
          last_full_sync_at: string
          platform_account_id: number
          problem_ids: string[]
          state_version: number
          total_records: number | null
          updated_at: string
        }
        Insert: {
          account_external_id: string
          boundary_record_id?: string | null
          boundary_submit_time?: number | null
          last_full_sync_at: string
          platform_account_id: number
          problem_ids?: string[]
          state_version?: number
          total_records?: number | null
          updated_at?: string
        }
        Update: {
          account_external_id?: string
          boundary_record_id?: string | null
          boundary_submit_time?: number | null
          last_full_sync_at?: string
          platform_account_id?: number
          problem_ids?: string[]
          state_version?: number
          total_records?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'luogu_sync_states_platform_account_id_fkey'
            columns: ['platform_account_id']
            isOneToOne: true
            referencedRelation: 'platform_accounts'
            referencedColumns: ['id']
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
      xcpc_elo_cache_players: {
        Row: {
          contests: number | null
          display_name: string
          max_rating: number | null
          normalized_name: string
          organization: string
          player_id: string
          rating: number
          version: number
        }
        Insert: {
          contests?: number | null
          display_name: string
          max_rating?: number | null
          normalized_name: string
          organization: string
          player_id: string
          rating: number
          version: number
        }
        Update: {
          contests?: number | null
          display_name?: string
          max_rating?: number | null
          normalized_name?: string
          organization?: string
          player_id?: string
          rating?: number
          version?: number
        }
        Relationships: []
      }
      xcpc_elo_cache_state: {
        Row: {
          active_version: number
          cache_key: boolean
          etag: string | null
          expires_at: string | null
          last_error_code: Database['public']['Enums']['sync_error_code'] | null
          last_error_message: string | null
          last_modified: string | null
          refresh_lease_expires_at: string | null
          refresh_owner: string | null
          refresh_retry_after: string | null
          source_generated_at: string | null
          updated_at: string
          validated_at: string | null
        }
        Insert: {
          active_version?: number
          cache_key?: boolean
          etag?: string | null
          expires_at?: string | null
          last_error_code?: Database['public']['Enums']['sync_error_code'] | null
          last_error_message?: string | null
          last_modified?: string | null
          refresh_lease_expires_at?: string | null
          refresh_owner?: string | null
          refresh_retry_after?: string | null
          source_generated_at?: string | null
          updated_at?: string
          validated_at?: string | null
        }
        Update: {
          active_version?: number
          cache_key?: boolean
          etag?: string | null
          expires_at?: string | null
          last_error_code?: Database['public']['Enums']['sync_error_code'] | null
          last_error_message?: string | null
          last_modified?: string | null
          refresh_lease_expires_at?: string | null
          refresh_owner?: string | null
          refresh_retry_after?: string | null
          source_generated_at?: string | null
          updated_at?: string
          validated_at?: string | null
        }
        Relationships: []
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
      acquire_account_deletion_recovery_lease: {
        Args: { p_owner_token: string; p_target_user_id: string }
        Returns: boolean
      }
      release_account_deletion_recovery_lease: {
        Args: { p_owner_token: string; p_target_user_id: string }
        Returns: boolean
      }
      renew_account_deletion_recovery_lease: {
        Args: { p_owner_token: string; p_target_user_id: string }
        Returns: boolean
      }
      delete_auth_user_with_recovery_lease: {
        Args: { p_owner_token: string; p_user_id: string }
        Returns: Json
      }
      consume_admin_rate_limit: {
        Args: {
          rate_action_key: string
          rate_actor_id: string
          rate_max_requests: number
          rate_window_seconds: number
        }
        Returns: {
          remaining_requests: number
          resets_at: string
        }[]
      }
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
      admin_get_member_detail: {
        Args: { target_profile_id: string }
        Returns: {
          account_id: number
          account_status: Database['public']['Enums']['account_verification_status']
          account_updated_at: string
          created_at: string
          current_rating: number
          email: string
          external_id: string
          full_name: string
          grade: string
          id: string
          is_public: boolean
          last_success_at: string
          major: string
          max_rating: number
          platform: Database['public']['Enums']['platform_name']
          qq: string
          review_status: Database['public']['Enums']['profile_review_status']
          solved_count: number
          source_observed_at: string
          source_version: string
          stale_after: string
          stat_status: Database['public']['Enums']['stat_freshness_status']
          stat_updated_at: string
          suspension_note: string
          updated_at: string
          verification_error_message: string
          verified_at: string
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
          role: Database['public']['Enums']['app_role']
          review_status: Database['public']['Enums']['profile_review_status']
          suspension_note: string
          updated_at: string
          verified_platform_count: number
        }[]
      }
      admin_list_announcements: {
        Args: { before_announcement_id?: number; row_limit?: number }
        Returns: {
          announcement_id: number
          body: string
          created_at: string
          created_by: string | null
          created_by_label: string
          expires_at: string | null
          published_at: string | null
          status: Database['public']['Enums']['announcement_status']
          title: string
          updated_at: string
          updated_by: string | null
          updated_by_label: string
        }[]
      }
      admin_list_member_activity: {
        Args: { row_limit?: number; target_profile_id: string }
        Returns: {
          action: string
          created_at: string
          detail: string
          event_id: string
          event_kind: string
          platform: string
          run_status: string
          source_version: string
          target_table: string
        }[]
      }
      admin_list_active_sync_jobs: {
        Args: { before_job_id?: number; row_limit?: number }
        Returns: {
          attempt_count: number
          created_at: string
          job_id: number
          last_error_code: Database['public']['Enums']['sync_error_code'] | null
          max_attempts: number
          member_name: string | null
          platform: Database['public']['Enums']['platform_name'] | null
          profile_id: string | null
          scheduled_for: string
          scope: Database['public']['Enums']['sync_job_scope']
          started_at: string | null
          status: Database['public']['Enums']['sync_job_status']
          trigger_type: Database['public']['Enums']['sync_trigger_type']
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
      admin_set_member_role: {
        Args: {
          expected_updated_at: string
          next_role: Database['public']['Enums']['app_role']
          reason: string
          target_profile_id: string
        }
        Returns: string
      }
      admin_set_manual_platform_stats: {
        Args: {
          expected_stat_updated_at?: string
          manual_current_rating: number | null
          manual_max_rating: number | null
          manual_note: string
          manual_solved_count: number | null
          manual_source_observed_at: string | null
          target_platform: Database['public']['Enums']['platform_name']
          target_profile_id: string
        }
        Returns: {
          stat_updated_at: string
          sync_run_id: number
        }[]
      }
      admin_update_member_profile: {
        Args: {
          expected_updated_at: string
          member_full_name: string
          member_grade: string
          member_is_public: boolean
          member_major: string
          member_qq: string
          target_profile_id: string
        }
        Returns: string
      }
      admin_unbind_member_platform_account: {
        Args: {
          expected_updated_at: string
          target_platform: Database['public']['Enums']['platform_name']
          target_profile_id: string
        }
        Returns: boolean
      }
      admin_delete_announcement: {
        Args: { expected_updated_at: string; target_announcement_id: number }
        Returns: boolean
      }
      admin_upsert_announcement: {
        Args: {
          announcement_body: string
          announcement_expires_at: string | null
          announcement_published_at: string | null
          announcement_status: Database['public']['Enums']['announcement_status']
          announcement_title: string
          expected_updated_at: string | null
          target_announcement_id: number | null
        }
        Returns: {
          announcement_id: number
          announcement_updated_at: string
        }[]
      }
      admin_upsert_member_platform_account: {
        Args: {
          expected_updated_at?: string
          new_external_id: string
          target_platform: Database['public']['Enums']['platform_name']
          target_profile_id: string
        }
        Returns: {
          account_id: number
          account_status: Database['public']['Enums']['account_verification_status']
          account_updated_at: string
        }[]
      }
      commit_platform_sync_result: {
        Args: {
          expected_external_id: string
          run_duration_ms: number
          run_finished_at: string
          run_metrics: Json | null
          stat_current_rating: number | null
          stat_error_code: Database['public']['Enums']['sync_error_code'] | null
          stat_error_message: string | null
          stat_fetched_at: string
          stat_last_success_at: string | null
          stat_max_rating: number | null
          stat_solved_count: number | null
          stat_source_observed_at: string | null
          stat_source_version: string | null
          stat_stale_after: string | null
          stat_status: Database['public']['Enums']['stat_freshness_status']
          sync_succeeded: boolean
          target_job_id: number
          target_platform_account_id: number
          target_run_id: number
        }
        Returns: undefined
      }
      commit_luogu_sync_result: {
        Args: {
          expected_external_id: string
          expected_state_version: number
          run_duration_ms: number
          run_finished_at: string
          run_metrics: Json | null
          state_boundary_record_id: string | null
          state_boundary_submit_time: number | null
          state_last_full_sync_at: string | null
          state_problem_ids: string[] | null
          state_total_records: number | null
          stat_current_rating: number | null
          stat_error_code: Database['public']['Enums']['sync_error_code'] | null
          stat_error_message: string | null
          stat_fetched_at: string
          stat_last_success_at: string | null
          stat_max_rating: number | null
          stat_solved_count: number | null
          stat_source_observed_at: string | null
          stat_source_version: string | null
          stat_stale_after: string | null
          stat_status: Database['public']['Enums']['stat_freshness_status']
          sync_succeeded: boolean
          target_job_id: number
          target_platform_account_id: number
          target_run_id: number
        }
        Returns: number
      }
      claim_due_sync_jobs: {
        Args: { batch_limit?: number; stale_timeout?: string }
        Returns: {
          attempt_count: number
          job_id: number
          max_attempts: number
          payload: Json
          platform: Database['public']['Enums']['platform_name']
          profile_id: string
        }[]
      }
      complete_sync_job_attempt: {
        Args: {
          attempt_succeeded: boolean
          expected_attempt: number
          failure_code?: Database['public']['Enums']['sync_error_code'] | null
          failure_message?: string | null
          failure_retryable?: boolean
          target_job_id: number
        }
        Returns: {
          job_status: Database['public']['Enums']['sync_job_status']
          retry_at: string | null
          transitioned: boolean
          transitioned_at: string | null
        }[]
      }
      bootstrap_first_admin: { Args: { target_email: string }; Returns: string }
      acquire_xcpc_elo_cache_refresh: {
        Args: { cache_ttl_seconds: number; lease_seconds: number; requested_owner: string }
        Returns: Json
      }
      can_edit_own_data: { Args: never; Returns: boolean }
      commit_xcpc_elo_cache_refresh: {
        Args: {
          cache_ttl_seconds: number
          requested_owner: string
          response_etag: string | null
          response_last_modified: string | null
          response_players: Json
          response_source_generated_at: string
        }
        Returns: number
      }
      fail_xcpc_elo_cache_refresh: {
        Args: {
          failure_code: Database['public']['Enums']['sync_error_code']
          failure_message: string | null
          requested_owner: string
          retry_after_seconds: number
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      read_xcpc_elo_cache: { Args: never; Returns: Json }
      validate_xcpc_elo_cache_refresh: {
        Args: {
          cache_ttl_seconds: number
          requested_owner: string
          response_etag: string | null
          response_last_modified: string | null
        }
        Returns: number
      }
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
