export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      api_tokens: {
        Row: {
          created_at: string;
          id: string;
          last_used_at: string | null;
          name: string;
          revoked_at: string | null;
          token_hash: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_used_at?: string | null;
          name: string;
          revoked_at?: string | null;
          token_hash: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_used_at?: string | null;
          name?: string;
          revoked_at?: string | null;
          token_hash?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      cards: {
        Row: {
          created_at: string;
          end_seconds: number | null;
          highlight_id: string | null;
          id: string;
          item_id: string | null;
          kind: string;
          note: string | null;
          position: number;
          project_id: string;
          quote: string;
          script_line: string | null;
          seconds: number | null;
          section_id: string | null;
          updated_at: string;
          url: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          end_seconds?: number | null;
          highlight_id?: string | null;
          id?: string;
          item_id?: string | null;
          kind: string;
          note?: string | null;
          position?: number;
          project_id: string;
          quote?: string;
          script_line?: string | null;
          seconds?: number | null;
          section_id?: string | null;
          updated_at?: string;
          url?: string | null;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          end_seconds?: number | null;
          highlight_id?: string | null;
          id?: string;
          item_id?: string | null;
          kind?: string;
          note?: string | null;
          position?: number;
          project_id?: string;
          quote?: string;
          script_line?: string | null;
          seconds?: number | null;
          section_id?: string | null;
          updated_at?: string;
          url?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cards_highlight_id_fkey";
            columns: ["highlight_id"];
            isOneToOne: false;
            referencedRelation: "highlights";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cards_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cards_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cards_section_id_fkey";
            columns: ["section_id"];
            isOneToOne: false;
            referencedRelation: "outline_sections";
            referencedColumns: ["id"];
          },
        ];
      };
      drive_state: {
        Row: {
          backup_enabled: boolean;
          created_at: string;
          last_saved_at: string | null;
          root_folder_id: string | null;
          sync_lock_until: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          backup_enabled?: boolean;
          created_at?: string;
          last_saved_at?: string | null;
          root_folder_id?: string | null;
          sync_lock_until?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          backup_enabled?: boolean;
          created_at?: string;
          last_saved_at?: string | null;
          root_folder_id?: string | null;
          sync_lock_until?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      folders: {
        Row: {
          archived_at: string | null;
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          drive_folder_id: string | null;
          drive_synced_at: string | null;
          id: string;
          name: string;
          parent_id: string | null;
          position: number;
          project_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          drive_folder_id?: string | null;
          drive_synced_at?: string | null;
          id?: string;
          name: string;
          parent_id?: string | null;
          position?: number;
          project_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          drive_folder_id?: string | null;
          drive_synced_at?: string | null;
          id?: string;
          name?: string;
          parent_id?: string | null;
          position?: number;
          project_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "folders_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      google_tokens: {
        Row: {
          created_at: string;
          refresh_token: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          refresh_token: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          refresh_token?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      highlights: {
        Row: {
          cited: Json;
          created_at: string;
          end_offset: number;
          id: string;
          image_src: string | null;
          item_id: string;
          kind: string;
          note: string | null;
          prefix: string;
          quote: string;
          seconds: number | null;
          start_offset: number;
          suffix: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          cited?: Json;
          created_at?: string;
          end_offset: number;
          id?: string;
          image_src?: string | null;
          item_id: string;
          kind: string;
          note?: string | null;
          prefix?: string;
          quote: string;
          seconds?: number | null;
          start_offset: number;
          suffix?: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          cited?: Json;
          created_at?: string;
          end_offset?: number;
          id?: string;
          image_src?: string | null;
          item_id?: string;
          kind?: string;
          note?: string | null;
          prefix?: string;
          quote?: string;
          seconds?: number | null;
          start_offset?: number;
          suffix?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "highlights_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
        ];
      };
      item_tldrs: {
        Row: {
          body_hash: string | null;
          created_at: string;
          item_id: string;
          model: string | null;
          source: string;
          tldr: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          body_hash?: string | null;
          created_at?: string;
          item_id: string;
          model?: string | null;
          source: string;
          tldr: Json;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          body_hash?: string | null;
          created_at?: string;
          item_id?: string;
          model?: string | null;
          source?: string;
          tldr?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "item_tldrs_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: true;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
        ];
      };
      items: {
        Row: {
          author: string | null;
          author_type: string | null;
          canonical_url: string | null;
          content_at: string | null;
          content_bytes: number | null;
          content_sha256: string | null;
          created_at: string;
          created_by: string | null;
          deleted_at: string | null;
          drive_file_id: string | null;
          drive_synced_at: string | null;
          error: string | null;
          folder_id: string;
          id: string;
          kind: string;
          markdown: string | null;
          meta: Json;
          note: string | null;
          position: number;
          project_id: string | null;
          source_url: string | null;
          status: string;
          storage_path: string | null;
          summary: string | null;
          tags: string[];
          title: string;
          triage: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          author?: string | null;
          author_type?: string | null;
          canonical_url?: string | null;
          content_at?: string | null;
          content_bytes?: number | null;
          content_sha256?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          drive_file_id?: string | null;
          drive_synced_at?: string | null;
          error?: string | null;
          folder_id: string;
          id?: string;
          kind: string;
          markdown?: string | null;
          meta?: Json;
          note?: string | null;
          position?: number;
          project_id?: string | null;
          source_url?: string | null;
          status?: string;
          storage_path?: string | null;
          summary?: string | null;
          tags?: string[];
          title: string;
          triage?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          author?: string | null;
          author_type?: string | null;
          canonical_url?: string | null;
          content_at?: string | null;
          content_bytes?: number | null;
          content_sha256?: string | null;
          created_at?: string;
          created_by?: string | null;
          deleted_at?: string | null;
          drive_file_id?: string | null;
          drive_synced_at?: string | null;
          error?: string | null;
          folder_id?: string;
          id?: string;
          kind?: string;
          markdown?: string | null;
          meta?: Json;
          note?: string | null;
          position?: number;
          project_id?: string | null;
          source_url?: string | null;
          status?: string;
          storage_path?: string | null;
          summary?: string | null;
          tags?: string[];
          title?: string;
          triage?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "items_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      link_queue: {
        Row: {
          added_by: string;
          attempts: number;
          claimed_at: string | null;
          claimed_by: string | null;
          created_at: string;
          folder_id: string;
          id: string;
          item_id: string | null;
          kind: string | null;
          message: string | null;
          needs: string;
          status: string;
          title: string | null;
          updated_at: string;
          url: string;
          user_id: string;
        };
        Insert: {
          added_by?: string;
          attempts?: number;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          folder_id: string;
          id?: string;
          item_id?: string | null;
          kind?: string | null;
          message?: string | null;
          needs?: string;
          status?: string;
          title?: string | null;
          updated_at?: string;
          url: string;
          user_id?: string;
        };
        Update: {
          added_by?: string;
          attempts?: number;
          claimed_at?: string | null;
          claimed_by?: string | null;
          created_at?: string;
          folder_id?: string;
          id?: string;
          item_id?: string | null;
          kind?: string | null;
          message?: string | null;
          needs?: string;
          status?: string;
          title?: string | null;
          updated_at?: string;
          url?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "link_queue_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "link_queue_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
        ];
      };
      link_workers: {
        Row: {
          can_run: boolean;
          kind: string;
          seen_at: string;
          user_id: string;
          version: string | null;
          worker_id: string;
        };
        Insert: {
          can_run?: boolean;
          kind: string;
          seen_at?: string;
          user_id?: string;
          version?: string | null;
          worker_id: string;
        };
        Update: {
          can_run?: boolean;
          kind?: string;
          seen_at?: string;
          user_id?: string;
          version?: string | null;
          worker_id?: string;
        };
        Relationships: [];
      };
      outline_sections: {
        Row: {
          created_at: string;
          id: string;
          position: number;
          project_id: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          position?: number;
          project_id: string;
          title: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          position?: number;
          project_id?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "outline_sections_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      project_invites: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          id: string;
          project_id: string;
          revoked_at: string | null;
          role: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          project_id: string;
          revoked_at?: string | null;
          role: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          project_id?: string;
          revoked_at?: string | null;
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_invites_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      project_members: {
        Row: {
          added_by: string | null;
          created_at: string;
          project_id: string;
          role: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          added_by?: string | null;
          created_at?: string;
          project_id: string;
          role?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          added_by?: string | null;
          created_at?: string;
          project_id?: string;
          role?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      shelf_links: {
        Row: {
          created_at: string;
          id: string;
          key: string;
          last_opened_at: string | null;
          note: string;
          open_count: number;
          pinned: boolean;
          tags: string[];
          title: string;
          updated_at: string;
          url: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          key: string;
          last_opened_at?: string | null;
          note?: string;
          open_count?: number;
          pinned?: boolean;
          tags?: string[];
          title?: string;
          updated_at?: string;
          url: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          key?: string;
          last_opened_at?: string | null;
          note?: string;
          open_count?: number;
          pinned?: boolean;
          tags?: string[];
          title?: string;
          updated_at?: string;
          url?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      signup_allow_list: {
        Row: {
          email: string;
        };
        Insert: {
          email: string;
        };
        Update: {
          email?: string;
        };
        Relationships: [];
      };
      text_undos: {
        Row: {
          after_hash: string;
          before_markdown: string;
          created_at: string;
          id: string;
          item_id: string;
          lost_highlights: Json;
          user_id: string;
        };
        Insert: {
          after_hash: string;
          before_markdown: string;
          created_at?: string;
          id?: string;
          item_id: string;
          lost_highlights?: Json;
          user_id?: string;
        };
        Update: {
          after_hash?: string;
          before_markdown?: string;
          created_at?: string;
          id?: string;
          item_id?: string;
          lost_highlights?: Json;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "text_undos_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
        ];
      };
      x_posts: {
        Row: {
          author_name: string;
          author_url: string;
          canonical_url: string;
          created_at: string;
          handle: string;
          id: string;
          item_id: string;
          media: Json;
          parent_id: string | null;
          position: number;
          post_url: string;
          posted_at: string | null;
          text: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          author_name: string;
          author_url: string;
          canonical_url: string;
          created_at?: string;
          handle: string;
          id?: string;
          item_id: string;
          media?: Json;
          parent_id?: string | null;
          position?: number;
          post_url: string;
          posted_at?: string | null;
          text: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          author_name?: string;
          author_url?: string;
          canonical_url?: string;
          created_at?: string;
          handle?: string;
          id?: string;
          item_id?: string;
          media?: Json;
          parent_id?: string | null;
          position?: number;
          post_url?: string;
          posted_at?: string | null;
          text?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "x_posts_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "x_posts_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "x_posts";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_project_invite: { Args: { p_code: string }; Returns: string };
      acquire_drive_sync_lock: {
        Args: { p_seconds?: number; p_user_id: string };
        Returns: boolean;
      };
      link_worker_check_in: {
        Args: {
          p_can_run?: boolean;
          p_kind: string;
          p_user_id?: string;
          p_version?: string;
          p_worker: string;
        };
        Returns: undefined;
      };
      claim_link_queue: {
        Args: {
          p_limit?: number;
          p_needs: string;
          p_user_id: string;
          p_worker: string;
        };
        Returns: Database["public"]["Tables"]["link_queue"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "link_queue";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      content_access: { Args: { p_item_id: string }; Returns: Json };
      content_drive_only_items: {
        Args: { p_limit?: number; p_user_id?: string };
        Returns: Database["public"]["Tables"]["items"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "items";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      content_waiting_items: {
        Args: { p_limit?: number; p_user_id?: string };
        Returns: Database["public"]["Tables"]["items"]["Row"][];
        SetofOptions: {
          from: "*";
          to: "items";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      drive_dirty_folders:
        | {
            Args: never;
            Returns: Database["public"]["Tables"]["folders"]["Row"][];
            SetofOptions: {
              from: "*";
              to: "folders";
              isOneToOne: false;
              isSetofReturn: true;
            };
          }
        | {
            Args: { p_user_id?: string };
            Returns: Database["public"]["Tables"]["folders"]["Row"][];
            SetofOptions: {
              from: "*";
              to: "folders";
              isOneToOne: false;
              isSetofReturn: true;
            };
          };
      drive_dirty_items:
        | {
            Args: { p_limit?: number };
            Returns: Database["public"]["Tables"]["items"]["Row"][];
            SetofOptions: {
              from: "*";
              to: "items";
              isOneToOne: false;
              isSetofReturn: true;
            };
          }
        | {
            Args: { p_limit?: number; p_user_id?: string };
            Returns: Database["public"]["Tables"]["items"]["Row"][];
            SetofOptions: {
              from: "*";
              to: "items";
              isOneToOne: false;
              isSetofReturn: true;
            };
          };
      drive_unsaved_count:
        { Args: never; Returns: number } | { Args: { p_user_id?: string }; Returns: number };
      folder_item_counts: {
        Args: { p_user_id: string };
        Returns: {
          folder_id: string;
          item_count: number;
        }[];
      };
      get_project_invite: {
        Args: { p_project_id: string; p_role?: string };
        Returns: string;
      };
      get_project_sharing: { Args: { p_project_id: string }; Returns: Json };
      health: { Args: never; Returns: string };
      hook_before_user_created: { Args: { event: Json }; Returns: Json };
      mark_folder_synced: {
        Args: { p_drive_folder_id: string; p_id: string };
        Returns: undefined;
      };
      mark_item_content_stored: {
        Args: {
          p_bytes: number;
          p_id: string;
          p_seen_updated_at: string;
          p_sha256: string;
          p_user_id?: string;
        };
        Returns: boolean;
      };
      mark_item_saved_to_drive: {
        Args: {
          p_drive_file_id: string;
          p_id: string;
          p_r2?: boolean;
          p_seen_updated_at: string;
        };
        Returns: boolean;
      };
      mark_item_stored_in_drive: {
        Args: {
          p_drive_file_id: string;
          p_id: string;
          p_seen_updated_at: string;
        };
        Returns: boolean;
      };
      mark_item_sync_failed: {
        Args: {
          p_give_up: boolean;
          p_item_id: string;
          p_meta: Json;
          p_user_id: string;
        };
        Returns: undefined;
      };
      mark_item_synced: {
        Args: { p_drive_file_id: string; p_id: string };
        Returns: undefined;
      };
      preview_project_invite: { Args: { p_code: string }; Returns: Json };
      project_access: {
        Args: { p_user_id?: string };
        Returns: {
          member_count: number;
          owner_email: string;
          owner_id: string;
          owner_name: string;
          project_id: string;
          your_role: string;
        }[];
      };
      release_drive_sync_lock: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      remove_project_member: {
        Args: { p_project_id: string; p_user_id: string };
        Returns: undefined;
      };
      reset_project_invite: {
        Args: { p_project_id: string; p_role?: string };
        Returns: string;
      };
      revoke_project_invite: {
        Args: { p_project_id: string; p_role?: string };
        Returns: undefined;
      };
      save_google_refresh_token: {
        Args: { p_refresh_token: string };
        Returns: undefined;
      };
      set_drive_backup: { Args: { p_enabled: boolean }; Returns: boolean };
      set_project_archived: {
        Args: { p_archived: boolean; p_id: string };
        Returns: boolean;
      };
      set_project_member_role: {
        Args: { p_project_id: string; p_role: string; p_user_id: string };
        Returns: undefined;
      };
      soft_delete_folder:
        | { Args: { p_folder_id: string }; Returns: undefined }
        | {
            Args: { p_folder_id: string; p_user_id?: string };
            Returns: undefined;
          };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
