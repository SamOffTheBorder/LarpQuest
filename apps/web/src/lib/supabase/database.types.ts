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
    PostgrestVersion: "14.15"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      api_keys: {
        Row: {
          created_at: string
          encrypted_key: string
          id: string
          label: string | null
          owner_id: string
          provider: string
          scope: string
          story_id: string | null
        }
        Insert: {
          created_at?: string
          encrypted_key: string
          id?: string
          label?: string | null
          owner_id: string
          provider?: string
          scope: string
          story_id?: string | null
        }
        Update: {
          created_at?: string
          encrypted_key?: string
          id?: string
          label?: string | null
          owner_id?: string
          provider?: string
          scope?: string
          story_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      arc_summaries: {
        Row: {
          created_at: string
          embedding: string | null
          from_chapter: number
          id: string
          story_id: string
          summary: string
          to_chapter: number
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          from_chapter: number
          id?: string
          story_id: string
          summary: string
          to_chapter: number
        }
        Update: {
          created_at?: string
          embedding?: string | null
          from_chapter?: number
          id?: string
          story_id?: string
          summary?: string
          to_chapter?: number
        }
        Relationships: [
          {
            foreignKeyName: "arc_summaries_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      canon_exceptions: {
        Row: {
          capability_id: string | null
          created_at: string
          created_by: string | null
          entity_id: string | null
          exception_note: string
          id: string
          rule_id: string
          story_id: string
        }
        Insert: {
          capability_id?: string | null
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          exception_note: string
          id?: string
          rule_id: string
          story_id: string
        }
        Update: {
          capability_id?: string | null
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          exception_note?: string
          id?: string
          rule_id?: string
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "canon_exceptions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "canon_exceptions_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      chapters: {
        Row: {
          created_at: string
          embedding: string | null
          entity_ids: string[]
          extracted_diffs: Json | null
          extraction_status: string
          id: string
          image_prompts: Json | null
          memory_status: string
          prose: string
          published_at: string
          rolled_back_at: string | null
          story_id: string
          summary: string | null
          turn_id: string | null
          turn_mode: string
          turn_number: number
          validation_report: Json | null
        }
        Insert: {
          created_at?: string
          embedding?: string | null
          entity_ids?: string[]
          extracted_diffs?: Json | null
          extraction_status?: string
          id?: string
          image_prompts?: Json | null
          memory_status?: string
          prose: string
          published_at?: string
          rolled_back_at?: string | null
          story_id: string
          summary?: string | null
          turn_id?: string | null
          turn_mode: string
          turn_number: number
          validation_report?: Json | null
        }
        Update: {
          created_at?: string
          embedding?: string | null
          entity_ids?: string[]
          extracted_diffs?: Json | null
          extraction_status?: string
          id?: string
          image_prompts?: Json | null
          memory_status?: string
          prose?: string
          published_at?: string
          rolled_back_at?: string | null
          story_id?: string
          summary?: string | null
          turn_id?: string | null
          turn_mode?: string
          turn_number?: number
          validation_report?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chapters_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chapters_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "turns"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          controlled_by: string | null
          created_at: string
          data: Json
          id: string
          name: string
          status: string
          story_id: string
          type: string
          updated_at: string
        }
        Insert: {
          controlled_by?: string | null
          created_at?: string
          data?: Json
          id?: string
          name: string
          status?: string
          story_id: string
          type: string
          updated_at?: string
        }
        Update: {
          controlled_by?: string | null
          created_at?: string
          data?: Json
          id?: string
          name?: string
          status?: string
          story_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entities_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_history: {
        Row: {
          applied_by: string | null
          chapter_id: string | null
          created_at: string
          diff: Json
          entity_id: string
          id: string
          is_reversal: boolean
          story_id: string
        }
        Insert: {
          applied_by?: string | null
          chapter_id?: string | null
          created_at?: string
          diff: Json
          entity_id: string
          id?: string
          is_reversal?: boolean
          story_id: string
        }
        Update: {
          applied_by?: string | null
          chapter_id?: string | null
          created_at?: string
          diff?: Json
          entity_id?: string
          id?: string
          is_reversal?: boolean
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_history_chapter_fk"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_history_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_history_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_queue: {
        Row: {
          attempt_count: number
          chapter_id: string
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          status: string
          story_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          chapter_id: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          status?: string
          story_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          chapter_id?: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          status?: string
          story_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_queue_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: true
            referencedRelation: "chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_queue_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_queue: {
        Row: {
          attempt_count: number
          chapter_id: string
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          status: string
          story_id: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          chapter_id: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          status?: string
          story_id: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          chapter_id?: string
          claimed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          status?: string
          story_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_queue_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: true
            referencedRelation: "chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_queue_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      proposals: {
        Row: {
          created_at: string
          entity_id: string | null
          gm_override: boolean
          id: string
          imposed_limits: Json | null
          narrative_cost: string | null
          proposal: string
          reasoning: string | null
          story_id: string
          suggested_alternative: string | null
          verdict: string | null
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          gm_override?: boolean
          id?: string
          imposed_limits?: Json | null
          narrative_cost?: string | null
          proposal: string
          reasoning?: string | null
          story_id: string
          suggested_alternative?: string | null
          verdict?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          gm_override?: boolean
          id?: string
          imposed_limits?: Json | null
          narrative_cost?: string | null
          proposal?: string
          reasoning?: string | null
          story_id?: string
          suggested_alternative?: string | null
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      research_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          draft_id: string
          id: string
          last_error: string | null
          output: Json | null
          previous_output: Json | null
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          draft_id: string
          id?: string
          last_error?: string | null
          output?: Json | null
          previous_output?: Json | null
          stage: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          draft_id?: string
          id?: string
          last_error?: string | null
          output?: Json | null
          previous_output?: Json | null
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_jobs_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "universe_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      stories: {
        Row: {
          conflict_policy: string
          content_rating: string
          created_at: string
          current_turn: number
          id: string
          model_config: Json
          owner_id: string
          status: string
          title: string
          turn_config: Json
          universe_id: string | null
          universe_version: number | null
          updated_at: string
          world_ledger: Json
        }
        Insert: {
          conflict_policy?: string
          content_rating: string
          created_at?: string
          current_turn?: number
          id?: string
          model_config?: Json
          owner_id: string
          status?: string
          title: string
          turn_config?: Json
          universe_id?: string | null
          universe_version?: number | null
          updated_at?: string
          world_ledger?: Json
        }
        Update: {
          conflict_policy?: string
          content_rating?: string
          created_at?: string
          current_turn?: number
          id?: string
          model_config?: Json
          owner_id?: string
          status?: string
          title?: string
          turn_config?: Json
          universe_id?: string | null
          universe_version?: number | null
          updated_at?: string
          world_ledger?: Json
        }
        Relationships: [
          {
            foreignKeyName: "stories_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stories_universe_version_fk"
            columns: ["universe_id", "universe_version"]
            isOneToOne: false
            referencedRelation: "universe_versions"
            referencedColumns: ["universe_id", "version"]
          },
        ]
      }
      story_invites: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          max_uses: number | null
          revoked_at: string | null
          role: string
          story_id: string
          token: string
          use_count: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          role: string
          story_id: string
          token: string
          use_count?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          max_uses?: number | null
          revoked_at?: string | null
          role?: string
          story_id?: string
          token?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "story_invites_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      story_members: {
        Row: {
          joined_at: string
          role: string
          story_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          role: string
          story_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          role?: string
          story_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_members_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      story_reports: {
        Row: {
          chapter_id: string | null
          created_at: string
          id: string
          reason: string
          reporter_id: string | null
          story_id: string
          submission_id: string | null
        }
        Insert: {
          chapter_id?: string | null
          created_at?: string
          id?: string
          reason: string
          reporter_id?: string | null
          story_id: string
          submission_id?: string | null
        }
        Update: {
          chapter_id?: string | null
          created_at?: string
          id?: string
          reason?: string
          reporter_id?: string | null
          story_id?: string
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "story_reports_chapter_id_fkey"
            columns: ["chapter_id"]
            isOneToOne: false
            referencedRelation: "chapters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_reports_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_reports_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      submissions: {
        Row: {
          content: string
          entity_id: string | null
          id: string
          proposals: Json | null
          story_id: string
          submitted_at: string
          turn_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          entity_id?: string | null
          id?: string
          proposals?: Json | null
          story_id: string
          submitted_at?: string
          turn_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          entity_id?: string | null
          id?: string
          proposals?: Json | null
          story_id?: string
          submitted_at?: string
          turn_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "submissions_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "turns"
            referencedColumns: ["id"]
          },
        ]
      }
      turn_mode_changes: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          new_mode: string
          previous_mode: string | null
          story_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_mode: string
          previous_mode?: string | null
          story_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_mode?: string
          previous_mode?: string | null
          story_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "turn_mode_changes_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      turns: {
        Row: {
          attempt_count: number
          created_at: string
          deadline: string | null
          failure_reason: string | null
          id: string
          mode: string
          moderation_reason: string | null
          moderation_status: string | null
          partial_prose: string | null
          scene_setup: string | null
          status: string
          story_id: string
          turn_number: number
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          deadline?: string | null
          failure_reason?: string | null
          id?: string
          mode?: string
          moderation_reason?: string | null
          moderation_status?: string | null
          partial_prose?: string | null
          scene_setup?: string | null
          status?: string
          story_id: string
          turn_number: number
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          deadline?: string | null
          failure_reason?: string | null
          id?: string
          mode?: string
          moderation_reason?: string | null
          moderation_status?: string | null
          partial_prose?: string | null
          scene_setup?: string | null
          status?: string
          story_id?: string
          turn_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "turns_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
      universe_drafts: {
        Row: {
          created_at: string
          draft: Json
          id: string
          input: Json
          owner_id: string
          published_version: number | null
          status: string
          universe_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft?: Json
          id?: string
          input: Json
          owner_id: string
          published_version?: number | null
          status?: string
          universe_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft?: Json
          id?: string
          input?: Json
          owner_id?: string
          published_version?: number | null
          status?: string
          universe_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "universe_drafts_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      universe_versions: {
        Row: {
          canon_bible_rules_only: Json | null
          canon_bible_summary: Json | null
          context_policy: Json
          created_at: string
          entity_schema: Json
          id: string
          progression_config: Json
          progression_model: string
          published_at: string
          universe_id: string
          validation_rules: Json
          version: number
        }
        Insert: {
          canon_bible_rules_only?: Json | null
          canon_bible_summary?: Json | null
          context_policy?: Json
          created_at?: string
          entity_schema: Json
          id?: string
          progression_config?: Json
          progression_model: string
          published_at?: string
          universe_id: string
          validation_rules?: Json
          version: number
        }
        Update: {
          canon_bible_rules_only?: Json | null
          canon_bible_summary?: Json | null
          context_policy?: Json
          created_at?: string
          entity_schema?: Json
          id?: string
          progression_config?: Json
          progression_model?: string
          published_at?: string
          universe_id?: string
          validation_rules?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "universe_versions_universe_id_fkey"
            columns: ["universe_id"]
            isOneToOne: false
            referencedRelation: "universes"
            referencedColumns: ["id"]
          },
        ]
      }
      universes: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      usage_log: {
        Row: {
          completion_tokens: number
          cost_usd: number
          created_at: string
          id: string
          model: string
          prompt_tokens: number
          role: string
          story_id: string | null
          succeeded: boolean
          used_fallback_model: boolean
          user_id: string | null
        }
        Insert: {
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          model: string
          prompt_tokens?: number
          role: string
          story_id?: string | null
          succeeded?: boolean
          used_fallback_model?: boolean
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          model?: string
          prompt_tokens?: number
          role?: string
          story_id?: string | null
          succeeded?: boolean
          used_fallback_model?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_log_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "stories"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_entity_update: {
        Args: {
          p_applied_by?: string
          p_chapter_id?: string
          p_data: Json
          p_diff: Json
          p_entity_id: string
          p_is_reversal?: boolean
        }
        Returns: {
          controlled_by: string | null
          created_at: string
          data: Json
          id: string
          name: string
          status: string
          story_id: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "entities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_extraction_job: {
        Args: { stale_after?: string }
        Returns: {
          attempt_count: number
          chapter_id: string
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          status: string
          story_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "extraction_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_memory_job: {
        Args: { stale_after?: string }
        Returns: {
          attempt_count: number
          chapter_id: string
          claimed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          status: string
          story_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "memory_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_entity_with_history: {
        Args: {
          p_controlled_by?: string
          p_created_by: string
          p_data: Json
          p_name: string
          p_story_id: string
          p_type: string
        }
        Returns: {
          controlled_by: string | null
          created_at: string
          data: Json
          id: string
          name: string
          status: string
          story_id: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "entities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_story:
        | {
            Args: {
              p_content_rating: string
              p_model_config: Json
              p_owner_id: string
              p_title: string
              p_turn_config?: Json
            }
            Returns: {
              conflict_policy: string
              content_rating: string
              created_at: string
              current_turn: number
              id: string
              model_config: Json
              owner_id: string
              status: string
              title: string
              turn_config: Json
              universe_id: string | null
              universe_version: number | null
              updated_at: string
              world_ledger: Json
            }
            SetofOptions: {
              from: "*"
              to: "stories"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_content_rating: string
              p_model_config: Json
              p_owner_id: string
              p_title: string
              p_turn_config?: Json
              p_universe_id?: string
              p_universe_version?: number
            }
            Returns: {
              conflict_policy: string
              content_rating: string
              created_at: string
              current_turn: number
              id: string
              model_config: Json
              owner_id: string
              status: string
              title: string
              turn_config: Json
              universe_id: string | null
              universe_version: number | null
              updated_at: string
              world_ledger: Json
            }
            SetofOptions: {
              from: "*"
              to: "stories"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      create_universe_with_version: {
        Args: {
          p_canon_bible_rules_only?: Json
          p_canon_bible_summary?: Json
          p_context_policy?: Json
          p_entity_schema: Json
          p_name: string
          p_owner_id: string
          p_progression_config?: Json
          p_progression_model: string
          p_validation_rules?: Json
        }
        Returns: {
          canon_bible_rules_only: Json | null
          canon_bible_summary: Json | null
          context_policy: Json
          created_at: string
          entity_schema: Json
          id: string
          progression_config: Json
          progression_model: string
          published_at: string
          universe_id: string
          validation_rules: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "universe_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_story_member: { Args: { target_story_id: string }; Returns: boolean }
      is_story_owner: { Args: { target_story_id: string }; Returns: boolean }
      is_story_role: {
        Args: { roles: string[]; target_story_id: string }
        Returns: boolean
      }
      join_story_via_invite: { Args: { p_token: string }; Returns: string }
      match_arc_summaries: {
        Args: {
          p_match_count?: number
          p_query_embedding: string
          p_story_id: string
        }
        Returns: {
          from_chapter: number
          similarity: number
          summary: string
          to_chapter: number
        }[]
      }
      match_chapter_summaries: {
        Args: {
          p_match_count?: number
          p_query_embedding: string
          p_story_id: string
        }
        Returns: {
          similarity: number
          summary: string
          turn_number: number
        }[]
      }
      open_turn: {
        Args: { p_mode?: string; p_scene_setup?: string; p_story_id: string }
        Returns: {
          attempt_count: number
          created_at: string
          deadline: string | null
          failure_reason: string | null
          id: string
          mode: string
          moderation_reason: string | null
          moderation_status: string | null
          partial_prose: string | null
          scene_setup: string | null
          status: string
          story_id: string
          turn_number: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "turns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      publish_chapter: {
        Args: {
          p_entity_ids?: string[]
          p_prose: string
          p_turn_id: string
          p_validation_report?: Json
        }
        Returns: {
          created_at: string
          embedding: string | null
          entity_ids: string[]
          extracted_diffs: Json | null
          extraction_status: string
          id: string
          image_prompts: Json | null
          memory_status: string
          prose: string
          published_at: string
          rolled_back_at: string | null
          story_id: string
          summary: string | null
          turn_id: string | null
          turn_mode: string
          turn_number: number
          validation_report: Json | null
        }
        SetofOptions: {
          from: "*"
          to: "chapters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      publish_universe_version: {
        Args: {
          p_canon_bible_rules_only?: Json
          p_canon_bible_summary?: Json
          p_context_policy?: Json
          p_entity_schema: Json
          p_owner_id: string
          p_progression_config?: Json
          p_progression_model: string
          p_universe_id: string
          p_validation_rules?: Json
        }
        Returns: {
          canon_bible_rules_only: Json | null
          canon_bible_summary: Json | null
          context_policy: Json
          created_at: string
          entity_schema: Json
          id: string
          progression_config: Json
          progression_model: string
          published_at: string
          universe_id: string
          validation_rules: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "universe_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rollback_chapter: {
        Args: { p_chapter_id: string; p_user_id: string }
        Returns: {
          entity_history_id: string
          entity_id: string
          field: string
          outcome: string
        }[]
      }
      start_research_job: {
        Args: { p_draft_id: string; p_stage: string }
        Returns: {
          attempt_count: number
          created_at: string
          draft_id: string
          id: string
          last_error: string | null
          output: Json | null
          previous_output: Json | null
          stage: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "research_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upgrade_story_universe_version: {
        Args: {
          p_owner_id: string
          p_story_id: string
          p_universe_version: number
        }
        Returns: {
          conflict_policy: string
          content_rating: string
          created_at: string
          current_turn: number
          id: string
          model_config: Json
          owner_id: string
          status: string
          title: string
          turn_config: Json
          universe_id: string | null
          universe_version: number | null
          updated_at: string
          world_ledger: Json
        }
        SetofOptions: {
          from: "*"
          to: "stories"
          isOneToOne: true
          isSetofReturn: false
        }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
