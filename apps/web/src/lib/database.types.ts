export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      api_tokens: {
        Row: {
          created_at: string
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          token_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          token_hash: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          token_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cards: {
        Row: {
          created_at: string
          end_seconds: number | null
          highlight_id: string | null
          id: string
          item_id: string | null
          kind: string
          note: string | null
          position: number
          project_id: string
          quote: string
          script_line: string | null
          seconds: number | null
          section_id: string | null
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          end_seconds?: number | null
          highlight_id?: string | null
          id?: string
          item_id?: string | null
          kind: string
          note?: string | null
          position?: number
          project_id: string
          quote?: string
          script_line?: string | null
          seconds?: number | null
          section_id?: string | null
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          end_seconds?: number | null
          highlight_id?: string | null
          id?: string
          item_id?: string | null
          kind?: string
          note?: string | null
          position?: number
          project_id?: string
          quote?: string
          script_line?: string | null
          seconds?: number | null
          section_id?: string | null
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cards_highlight_id_fkey"
            columns: ["highlight_id"]
            isOneToOne: false
            referencedRelation: "highlights"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cards_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "outline_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      drive_state: {
        Row: {
          created_at: string
          last_saved_at: string | null
          root_folder_id: string | null
          sync_lock_until: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_saved_at?: string | null
          root_folder_id?: string | null
          sync_lock_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          last_saved_at?: string | null
          root_folder_id?: string | null
          sync_lock_until?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      folders: {
        Row: {
          archived_at: string | null
          created_at: string
          deleted_at: string | null
          drive_folder_id: string | null
          drive_synced_at: string | null
          id: string
          name: string
          parent_id: string | null
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          drive_folder_id?: string | null
          drive_synced_at?: string | null
          id?: string
          name: string
          parent_id?: string | null
          position?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          deleted_at?: string | null
          drive_folder_id?: string | null
          drive_synced_at?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      google_tokens: {
        Row: {
          created_at: string
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      highlights: {
        Row: {
          cited: Json
          created_at: string
          end_offset: number
          id: string
          image_src: string | null
          item_id: string
          kind: string
          note: string | null
          prefix: string
          quote: string
          seconds: number | null
          start_offset: number
          suffix: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cited?: Json
          created_at?: string
          end_offset: number
          id?: string
          image_src?: string | null
          item_id: string
          kind: string
          note?: string | null
          prefix?: string
          quote: string
          seconds?: number | null
          start_offset: number
          suffix?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          cited?: Json
          created_at?: string
          end_offset?: number
          id?: string
          image_src?: string | null
          item_id?: string
          kind?: string
          note?: string | null
          prefix?: string
          quote?: string
          seconds?: number | null
          start_offset?: number
          suffix?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "highlights_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          author: string | null
          author_type: string | null
          canonical_url: string | null
          created_at: string
          deleted_at: string | null
          drive_file_id: string | null
          drive_synced_at: string | null
          error: string | null
          folder_id: string
          id: string
          kind: string
          markdown: string | null
          meta: Json
          note: string | null
          position: number
          source_url: string | null
          status: string
          storage_path: string | null
          summary: string | null
          tags: string[]
          title: string
          triage: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          author?: string | null
          author_type?: string | null
          canonical_url?: string | null
          created_at?: string
          deleted_at?: string | null
          drive_file_id?: string | null
          drive_synced_at?: string | null
          error?: string | null
          folder_id: string
          id?: string
          kind: string
          markdown?: string | null
          meta?: Json
          note?: string | null
          position?: number
          source_url?: string | null
          status?: string
          storage_path?: string | null
          summary?: string | null
          tags?: string[]
          title: string
          triage?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          author?: string | null
          author_type?: string | null
          canonical_url?: string | null
          created_at?: string
          deleted_at?: string | null
          drive_file_id?: string | null
          drive_synced_at?: string | null
          error?: string | null
          folder_id?: string
          id?: string
          kind?: string
          markdown?: string | null
          meta?: Json
          note?: string | null
          position?: number
          source_url?: string | null
          status?: string
          storage_path?: string | null
          summary?: string | null
          tags?: string[]
          title?: string
          triage?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      outline_sections: {
        Row: {
          created_at: string
          id: string
          position: number
          project_id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          project_id: string
          title: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          project_id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outline_sections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      x_posts: {
        Row: {
          author_name: string
          author_url: string
          canonical_url: string
          created_at: string
          handle: string
          id: string
          item_id: string
          parent_id: string | null
          position: number
          post_url: string
          posted_at: string | null
          text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          author_name: string
          author_url: string
          canonical_url: string
          created_at?: string
          handle: string
          id?: string
          item_id: string
          parent_id?: string | null
          position?: number
          post_url: string
          posted_at?: string | null
          text: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          author_name?: string
          author_url?: string
          canonical_url?: string
          created_at?: string
          handle?: string
          id?: string
          item_id?: string
          parent_id?: string | null
          position?: number
          post_url?: string
          posted_at?: string | null
          text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "x_posts_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "x_posts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "x_posts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_drive_sync_lock: {
        Args: { p_seconds?: number; p_user_id: string }
        Returns: boolean
      }
      drive_dirty_folders: {
        Args: { p_user_id?: string }
        Returns: {
          archived_at: string | null
          created_at: string
          deleted_at: string | null
          drive_folder_id: string | null
          drive_synced_at: string | null
          id: string
          name: string
          parent_id: string | null
          position: number
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "folders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      drive_dirty_items: {
        Args: { p_limit?: number; p_user_id?: string }
        Returns: {
          author: string | null
          author_type: string | null
          canonical_url: string | null
          created_at: string
          deleted_at: string | null
          drive_file_id: string | null
          drive_synced_at: string | null
          error: string | null
          folder_id: string
          id: string
          kind: string
          markdown: string | null
          meta: Json
          note: string | null
          position: number
          source_url: string | null
          status: string
          storage_path: string | null
          summary: string | null
          tags: string[]
          title: string
          triage: string | null
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "items"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      drive_unsaved_count: { Args: { p_user_id?: string }; Returns: number }
      folder_item_counts: {
        Args: { p_user_id: string }
        Returns: {
          folder_id: string
          item_count: number
        }[]
      }
      health: { Args: never; Returns: string }
      mark_folder_synced: {
        Args: { p_drive_folder_id: string; p_id: string }
        Returns: undefined
      }
      mark_item_stored_in_drive: {
        Args: {
          p_drive_file_id: string
          p_id: string
          p_seen_updated_at: string
        }
        Returns: boolean
      }
      mark_item_sync_failed: {
        Args: {
          p_give_up: boolean
          p_item_id: string
          p_meta: Json
          p_user_id: string
        }
        Returns: undefined
      }
      mark_item_synced: {
        Args: { p_drive_file_id: string; p_id: string }
        Returns: undefined
      }
      release_drive_sync_lock: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      set_project_archived: {
        Args: { p_archived: boolean; p_id: string }
        Returns: boolean
      }
      save_google_refresh_token: {
        Args: { p_refresh_token: string }
        Returns: undefined
      }
      soft_delete_folder: {
        Args: { p_folder_id: string; p_user_id?: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
