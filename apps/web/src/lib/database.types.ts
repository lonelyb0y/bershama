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
    PostgrestVersion: "14.5"
  }
  api: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_requisition_line: {
        Args: {
          p_product_id: string
          p_qty_requested: number
          p_requisition_id: string
        }
        Returns: Database["public"]["Tables"]["requisition_lines"]["Row"]
        SetofOptions: {
          from: "*"
          to: "requisition_lines"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_trip_stop: {
        Args: {
          p_facility_id: string
          p_requisition_id?: string
          p_sequence?: number
          p_trip_id: string
        }
        Returns: Database["public"]["Tables"]["delivery_stops"]["Row"]
        SetofOptions: {
          from: "*"
          to: "delivery_stops"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      adjust_stock: {
        Args: {
          p_batch_id: string
          p_location_id: string
          p_notes?: string
          p_product_id: string
          p_qty_delta: number
          p_reason_code: string
        }
        Returns: number
      }
      allocate_requisition: {
        Args: { p_requisition_id: string }
        Returns: {
          allocated: number
          line_product: string
          requested: number
          requisition_id: string
          shortage: number
        }[]
      }
      arrive_at_stop: {
        Args: { p_latitude?: number; p_longitude?: number; p_stop_id: string }
        Returns: Database["public"]["Tables"]["delivery_stops"]["Row"]
        SetofOptions: {
          from: "*"
          to: "delivery_stops"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_stop: {
        Args: {
          p_device_id?: string
          p_latitude?: number
          p_longitude?: number
          p_meaning: string
          p_photo_url?: string
          p_recipient_name: string
          p_signature_data?: string
          p_stop_id: string
          p_unsigned_reason?: string
        }
        Returns: Database["public"]["Tables"]["delivery_stops"]["Row"]
        SetofOptions: {
          from: "*"
          to: "delivery_stops"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_trip: {
        Args: { p_trip_id: string }
        Returns: Database["public"]["Tables"]["trips"]["Row"]
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_batch: {
        Args: {
          p_expiry_date: string
          p_lot_number: string
          p_mfg_date: string
          p_product_id: string
          p_release_now?: boolean
          p_supplier_name?: string
          p_supplier_ref?: string
          p_unit_cost_minor?: number
        }
        Returns: Database["public"]["Tables"]["batches"]["Row"]
        SetofOptions: {
          from: "*"
          to: "batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_location: {
        Args: {
          p_code: string
          p_facility_id: string
          p_kind?: string
          p_name_ar: string
          p_name_en: string
          p_temp_max_c?: number
          p_temp_min_c?: number
        }
        Returns: Database["public"]["Tables"]["storage_locations"]["Row"]
        SetofOptions: {
          from: "*"
          to: "storage_locations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_product: {
        Args: {
          p_atc_code?: string
          p_brand?: string
          p_eda_reg_no?: string
          p_form?: string
          p_generic_name_ar?: string
          p_generic_name_en?: string
          p_gtin?: string
          p_is_cold_chain?: boolean
          p_is_controlled?: boolean
          p_name_ar: string
          p_name_en: string
          p_pack_size?: number
          p_requires_prescription?: boolean
          p_shelf_life_months?: number
          p_sku: string
          p_strength?: string
          p_strength_unit?: string
          p_uom?: string
        }
        Returns: Database["public"]["Tables"]["products"]["Row"]
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_requisition: {
        Args: { p_facility_id: string; p_justification?: string }
        Returns: Database["public"]["Tables"]["requisitions"]["Row"]
        SetofOptions: {
          from: "*"
          to: "requisitions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_trip: {
        Args: { p_notes?: string; p_run_date: string; p_vehicle_id?: string }
        Returns: Database["public"]["Tables"]["trips"]["Row"]
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_vehicle: {
        Args: {
          p_code: string
          p_description?: string
          p_plate_number?: string
        }
        Returns: Database["public"]["Tables"]["vehicles"]["Row"]
        SetofOptions: {
          from: "*"
          to: "vehicles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_tenant_id: { Args: never; Returns: string }
      dispatch_trip: {
        Args: { p_driver_id: string; p_trip_id: string }
        Returns: Database["public"]["Tables"]["trips"]["Row"]
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fail_stop: {
        Args: { p_reason: string; p_stop_id: string }
        Returns: Database["public"]["Tables"]["delivery_stops"]["Row"]
        SetofOptions: {
          from: "*"
          to: "delivery_stops"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_batch_stock: {
        Args: { p_batch_id: string }
        Returns: {
          batch_id: string
          days_to_expiry: number
          expiry_date: string
          facility_id: string
          location_code: string
          location_id: string
          lot_number: string
          mfg_date: string
          product_id: string
          product_name_ar: string
          product_name_en: string
          qty_available: number
          qty_on_hand: number
          qty_reserved: number
          status:
            | "QUARANTINED"
            | "RELEASED"
            | "RECALLED"
            | "EXPIRED"
            | "DEPLETED"
          unit_cost_minor: number
        }[]
      }
      get_product: { Args: { p_product_id: string }; Returns: Json }
      issue_stock: {
        Args: {
          p_batch_id: string
          p_location_id: string
          p_notes?: string
          p_product_id: string
          p_qty: number
          p_reference_id?: string
          p_reference_type?: string
        }
        Returns: number
      }
      quarantine_batch: {
        Args: { p_batch_id: string; p_reason: string }
        Returns: Database["public"]["Tables"]["batches"]["Row"]
        SetofOptions: {
          from: "*"
          to: "batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recall_batch: {
        Args: { p_batch_id: string; p_reason: string }
        Returns: Database["public"]["Tables"]["batches"]["Row"]
        SetofOptions: {
          from: "*"
          to: "batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      receive_stock: {
        Args: {
          p_batch_id: string
          p_location_id: string
          p_notes?: string
          p_product_id: string
          p_qty: number
          p_supplier_ref?: string
          p_unit_cost_minor?: number
        }
        Returns: number
      }
      reject_requisition: {
        Args: { p_note: string; p_requisition_id: string }
        Returns: Database["public"]["Tables"]["requisitions"]["Row"]
        SetofOptions: {
          from: "*"
          to: "requisitions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_batch: {
        Args: { p_batch_id: string; p_reason?: string }
        Returns: Database["public"]["Tables"]["batches"]["Row"]
        SetofOptions: {
          from: "*"
          to: "batches"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_requisition: {
        Args: { p_requisition_id: string }
        Returns: undefined
      }
      remove_requisition_line: {
        Args: { p_line_id: string }
        Returns: undefined
      }
      search_products: {
        Args: {
          p_expiry_band?: string
          p_limit?: number
          p_offset?: number
          p_query?: string
        }
        Returns: {
          atc_code: string
          brand: string
          earliest_expiry: string
          form:
            | "TABLET"
            | "CAPSULE"
            | "SYRUP"
            | "SUSPENSION"
            | "INJECTION"
            | "VIAL"
            | "SACHET"
            | "CREAM"
            | "OINTMENT"
            | "SUPPOSITORY"
            | "DROPS"
            | "INHALER"
            | "PATCH"
          generic_name_ar: string
          generic_name_en: string
          gtin: string
          id: string
          is_active: boolean
          is_cold_chain: boolean
          name_ar: string
          name_en: string
          pack_size: number
          qty_available: number
          qty_on_hand: number
          requires_prescription: boolean
          sku: string
          strength: string
          total_count: number
          uom: "BOX" | "STRIP" | "BOTTLE" | "TUBE" | "VIAL" | "SACHET" | "KIT"
        }[]
      }
      set_product_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: Database["public"]["Tables"]["products"]["Row"]
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_trip: {
        Args: { p_trip_id: string }
        Returns: Database["public"]["Tables"]["trips"]["Row"]
        SetofOptions: {
          from: "*"
          to: "trips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stock_take: {
        Args: {
          p_batch_id: string
          p_counted_qty: number
          p_location_id: string
          p_notes?: string
          p_product_id: string
          p_reason_code: string
        }
        Returns: number
      }
      submit_requisition: {
        Args: { p_requisition_id: string }
        Returns: Database["public"]["Tables"]["requisitions"]["Row"]
        SetofOptions: {
          from: "*"
          to: "requisitions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      touch: { Args: never; Returns: undefined }
      transfer_stock: {
        Args: {
          p_batch_id: string
          p_from_location: string
          p_notes?: string
          p_product_id: string
          p_qty: number
          p_reason_code?: string
          p_to_location: string
        }
        Returns: number
      }
      update_my_profile: {
        Args: {
          p_full_name?: string
          p_full_name_ar?: string
          p_locale?: string
          p_phone?: string
        }
        Returns: Database["public"]["Tables"]["profiles"]["Row"]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_product: {
        Args: {
          p_atc_code?: string
          p_brand?: string
          p_eda_reg_no?: string
          p_form?: string
          p_generic_name_ar?: string
          p_generic_name_en?: string
          p_gtin?: string
          p_id: string
          p_is_cold_chain?: boolean
          p_is_controlled?: boolean
          p_name_ar: string
          p_name_en: string
          p_pack_size?: number
          p_requires_prescription?: boolean
          p_shelf_life_months?: number
          p_strength?: string
          p_strength_unit?: string
          p_uom?: string
        }
        Returns: Database["public"]["Tables"]["products"]["Row"]
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_tenant_settings: {
        Args: { p_patch: Json }
        Returns: Database["public"]["Tables"]["tenants"]["Row"]
        SetofOptions: {
          from: "*"
          to: "tenants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      whoami: {
        Args: never
        Returns: {
          currency_code: string
          full_name: string
          full_name_ar: string
          locale: string
          role:
            | "TENANT_ADMIN"
            | "WAREHOUSE_MANAGER"
            | "DISPATCHER"
            | "DRIVER"
            | "PHARMACY_MANAGER"
            | "DISTRIBUTOR"
            | "ANALYST"
          tenant_id: string
          tenant_slug: string
          timezone: string
          user_id: string
          vat_rate: number
        }[]
      }
      write_off_stock: {
        Args: {
          p_batch_id: string
          p_location_id: string
          p_notes?: string
          p_product_id: string
          p_qty: number
          p_reason_code: string
        }
        Returns: number
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
      alert_events: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          data: Json
          entity_id: string | null
          entity_type: string
          first_seen_at: string
          id: string
          last_seen_at: string
          message: string
          occurrences: number
          resolved_at: string | null
          resolved_by: string | null
          severity: "INFO" | "WARN" | "CRITICAL"
          status: "OPEN" | "ACK" | "RESOLVED" | "SNOOZED"
          tenant_id: string
          type:
            | "LOW_STOCK"
            | "NEAR_EXPIRY"
            | "EXPIRED"
            | "OVERSTOCK"
            | "ORDER_OVERDUE"
            | "DELIVERY_FAILED"
            | "COLD_CHAIN_BREACH"
            | "RECALL"
            | "STOCK_DRIFT"
            | "NEGATIVE_STOCK"
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          message: string
          occurrences?: number
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: "INFO" | "WARN" | "CRITICAL"
          status?: "OPEN" | "ACK" | "RESOLVED" | "SNOOZED"
          tenant_id: string
          type:
            | "LOW_STOCK"
            | "NEAR_EXPIRY"
            | "EXPIRED"
            | "OVERSTOCK"
            | "ORDER_OVERDUE"
            | "DELIVERY_FAILED"
            | "COLD_CHAIN_BREACH"
            | "RECALL"
            | "STOCK_DRIFT"
            | "NEGATIVE_STOCK"
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          message?: string
          occurrences?: number
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: "INFO" | "WARN" | "CRITICAL"
          status?: "OPEN" | "ACK" | "RESOLVED" | "SNOOZED"
          tenant_id?: string
          type?:
            | "LOW_STOCK"
            | "NEAR_EXPIRY"
            | "EXPIRED"
            | "OVERSTOCK"
            | "ORDER_OVERDUE"
            | "DELIVERY_FAILED"
            | "COLD_CHAIN_BREACH"
            | "RECALL"
            | "STOCK_DRIFT"
            | "NEGATIVE_STOCK"
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_events_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_events_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_label: string | null
          actor_role:
            | "TENANT_ADMIN"
            | "WAREHOUSE_MANAGER"
            | "DISPATCHER"
            | "DRIVER"
            | "PHARMACY_MANAGER"
            | "DISTRIBUTOR"
            | "ANALYST"
            | null
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          entity_id: string | null
          entity_type: string
          id: number
          ip_address: unknown
          occurred_at: string
          request_id: string | null
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_label?: string | null
          actor_role?:
            | "TENANT_ADMIN"
            | "WAREHOUSE_MANAGER"
            | "DISPATCHER"
            | "DRIVER"
            | "PHARMACY_MANAGER"
            | "DISTRIBUTOR"
            | "ANALYST"
            | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: never
          ip_address?: unknown
          occurred_at?: string
          request_id?: string | null
          tenant_id: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_label?: string | null
          actor_role?:
            | "TENANT_ADMIN"
            | "WAREHOUSE_MANAGER"
            | "DISPATCHER"
            | "DRIVER"
            | "PHARMACY_MANAGER"
            | "DISTRIBUTOR"
            | "ANALYST"
            | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: never
          ip_address?: unknown
          occurred_at?: string
          request_id?: string | null
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      batches: {
        Row: {
          created_at: string
          delete_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          expiry_date: string
          id: string
          lot_number: string
          mfg_date: string
          product_id: string
          received_at: string
          released_at: string | null
          released_by: string | null
          status:
            | "QUARANTINED"
            | "RELEASED"
            | "RECALLED"
            | "EXPIRED"
            | "DEPLETED"
          status_changed_at: string | null
          status_changed_by: string | null
          status_reason: string | null
          supplier_name: string | null
          supplier_ref: string | null
          tenant_id: string
          unit_cost_minor: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          expiry_date: string
          id?: string
          lot_number: string
          mfg_date: string
          product_id: string
          received_at?: string
          released_at?: string | null
          released_by?: string | null
          status?:
            | "QUARANTINED"
            | "RELEASED"
            | "RECALLED"
            | "EXPIRED"
            | "DEPLETED"
          status_changed_at?: string | null
          status_changed_by?: string | null
          status_reason?: string | null
          supplier_name?: string | null
          supplier_ref?: string | null
          tenant_id: string
          unit_cost_minor?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          delete_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          expiry_date?: string
          id?: string
          lot_number?: string
          mfg_date?: string
          product_id?: string
          received_at?: string
          released_at?: string | null
          released_by?: string | null
          status?:
            | "QUARANTINED"
            | "RELEASED"
            | "RECALLED"
            | "EXPIRED"
            | "DEPLETED"
          status_changed_at?: string | null
          status_changed_by?: string | null
          status_reason?: string | null
          supplier_name?: string | null
          supplier_ref?: string | null
          tenant_id?: string
          unit_cost_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "batches_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_stops: {
        Row: {
          arrived_at: string | null
          closed_at: string | null
          created_at: string
          delivered_at: string | null
          eta: string | null
          facility_id: string
          failure_reason: string | null
          id: string
          latitude: number | null
          longitude: number | null
          requisition_id: string | null
          sequence: number
          status:
            | "PENDING"
            | "ARRIVED"
            | "DELIVERED"
            | "FAILED"
            | "RETURNED"
            | "SKIPPED"
          tenant_id: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          arrived_at?: string | null
          closed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          eta?: string | null
          facility_id: string
          failure_reason?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          requisition_id?: string | null
          sequence: number
          status?:
            | "PENDING"
            | "ARRIVED"
            | "DELIVERED"
            | "FAILED"
            | "RETURNED"
            | "SKIPPED"
          tenant_id: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          arrived_at?: string | null
          closed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          eta?: string | null
          facility_id?: string
          failure_reason?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          requisition_id?: string | null
          sequence?: number
          status?:
            | "PENDING"
            | "ARRIVED"
            | "DELIVERED"
            | "FAILED"
            | "RETURNED"
            | "SKIPPED"
          tenant_id?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_stops_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_stops_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "requisitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_stops_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_stops_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          address: string | null
          city: string | null
          code: string
          created_at: string
          governorate: string | null
          id: string
          is_active: boolean
          kind: "WAREHOUSE" | "PHARMACY" | "HOSPITAL" | "CLINIC"
          latitude: number | null
          license_no: string | null
          longitude: number | null
          name_ar: string
          name_en: string
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          code: string
          created_at?: string
          governorate?: string | null
          id?: string
          is_active?: boolean
          kind: "WAREHOUSE" | "PHARMACY" | "HOSPITAL" | "CLINIC"
          latitude?: number | null
          license_no?: string | null
          longitude?: number | null
          name_ar: string
          name_en: string
          phone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string
          created_at?: string
          governorate?: string | null
          id?: string
          is_active?: boolean
          kind?: "WAREHOUSE" | "PHARMACY" | "HOSPITAL" | "CLINIC"
          latitude?: number | null
          license_no?: string | null
          longitude?: number | null
          name_ar?: string
          name_en?: string
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "facilities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          facility_id: string | null
          full_name: string
          id: string
          invited_by: string | null
          role:
            | "TENANT_ADMIN"
            | "WAREHOUSE_MANAGER"
            | "DISPATCHER"
            | "DRIVER"
            | "PHARMACY_MANAGER"
            | "DISTRIBUTOR"
            | "ANALYST"
          status: string
          tenant_id: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          facility_id?: string | null
          full_name: string
          id?: string
          invited_by?: string | null
          role:
            | "TENANT_ADMIN"
            | "WAREHOUSE_MANAGER"
            | "DISPATCHER"
            | "DRIVER"
            | "PHARMACY_MANAGER"
            | "DISTRIBUTOR"
            | "ANALYST"
          status?: string
          tenant_id: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          facility_id?: string | null
          full_name?: string
          id?: string
          invited_by?: string | null
          role?:
            | "TENANT_ADMIN"
            | "WAREHOUSE_MANAGER"
            | "DISPATCHER"
            | "DRIVER"
            | "PHARMACY_MANAGER"
            | "DISTRIBUTOR"
            | "ANALYST"
          status?: string
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          atc_code: string | null
          brand: string | null
          created_at: string
          eda_reg_no: string | null
          form:
            | "TABLET"
            | "CAPSULE"
            | "SYRUP"
            | "SUSPENSION"
            | "INJECTION"
            | "VIAL"
            | "SACHET"
            | "CREAM"
            | "OINTMENT"
            | "SUPPOSITORY"
            | "DROPS"
            | "INHALER"
            | "PATCH"
          generic_name_ar: string | null
          generic_name_en: string | null
          gtin: string | null
          id: string
          is_active: boolean
          is_cold_chain: boolean
          is_controlled: boolean
          is_serialised: boolean
          name_ar: string
          name_en: string
          pack_size: number
          requires_prescription: boolean
          shelf_life_months: number
          sku: string
          strength: string
          strength_unit: "mg" | "g" | "mcg" | "ml" | "IU" | "%" | "units" | null
          tenant_id: string
          uom: "BOX" | "STRIP" | "BOTTLE" | "TUBE" | "VIAL" | "SACHET" | "KIT"
          updated_at: string
        }
        Insert: {
          atc_code?: string | null
          brand?: string | null
          created_at?: string
          eda_reg_no?: string | null
          form:
            | "TABLET"
            | "CAPSULE"
            | "SYRUP"
            | "SUSPENSION"
            | "INJECTION"
            | "VIAL"
            | "SACHET"
            | "CREAM"
            | "OINTMENT"
            | "SUPPOSITORY"
            | "DROPS"
            | "INHALER"
            | "PATCH"
          generic_name_ar?: string | null
          generic_name_en?: string | null
          gtin?: string | null
          id?: string
          is_active?: boolean
          is_cold_chain?: boolean
          is_controlled?: boolean
          is_serialised?: boolean
          name_ar: string
          name_en: string
          pack_size?: number
          requires_prescription?: boolean
          shelf_life_months?: number
          sku: string
          strength: string
          strength_unit?:
            | "mg"
            | "g"
            | "mcg"
            | "ml"
            | "IU"
            | "%"
            | "units"
            | null
          tenant_id: string
          uom?: "BOX" | "STRIP" | "BOTTLE" | "TUBE" | "VIAL" | "SACHET" | "KIT"
          updated_at?: string
        }
        Update: {
          atc_code?: string | null
          brand?: string | null
          created_at?: string
          eda_reg_no?: string | null
          form?:
            | "TABLET"
            | "CAPSULE"
            | "SYRUP"
            | "SUSPENSION"
            | "INJECTION"
            | "VIAL"
            | "SACHET"
            | "CREAM"
            | "OINTMENT"
            | "SUPPOSITORY"
            | "DROPS"
            | "INHALER"
            | "PATCH"
          generic_name_ar?: string | null
          generic_name_en?: string | null
          gtin?: string | null
          id?: string
          is_active?: boolean
          is_cold_chain?: boolean
          is_controlled?: boolean
          is_serialised?: boolean
          name_ar?: string
          name_en?: string
          pack_size?: number
          requires_prescription?: boolean
          shelf_life_months?: number
          sku?: string
          strength?: string
          strength_unit?:
            | "mg"
            | "g"
            | "mcg"
            | "ml"
            | "IU"
            | "%"
            | "units"
            | null
          tenant_id?: string
          uom?: "BOX" | "STRIP" | "BOTTLE" | "TUBE" | "VIAL" | "SACHET" | "KIT"
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          full_name_ar: string | null
          id: string
          is_active: boolean
          last_seen_at: string | null
          locale: string
          phone: string | null
          role:
            | "TENANT_ADMIN"
            | "WAREHOUSE_MANAGER"
            | "DISPATCHER"
            | "DRIVER"
            | "PHARMACY_MANAGER"
            | "DISTRIBUTOR"
            | "ANALYST"
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          full_name_ar?: string | null
          id: string
          is_active?: boolean
          last_seen_at?: string | null
          locale?: string
          phone?: string | null
          role:
            | "TENANT_ADMIN"
            | "WAREHOUSE_MANAGER"
            | "DISPATCHER"
            | "DRIVER"
            | "PHARMACY_MANAGER"
            | "DISTRIBUTOR"
            | "ANALYST"
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          full_name_ar?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          locale?: string
          phone?: string | null
          role?:
            | "TENANT_ADMIN"
            | "WAREHOUSE_MANAGER"
            | "DISPATCHER"
            | "DRIVER"
            | "PHARMACY_MANAGER"
            | "DISTRIBUTOR"
            | "ANALYST"
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      proofs_of_delivery: {
        Row: {
          device_id: string | null
          id: string
          meaning: string
          photo_url: string | null
          recipient_name: string
          signature_data: string | null
          signed_at: string
          stop_id: string
          tenant_id: string
          unsigned_reason: string | null
        }
        Insert: {
          device_id?: string | null
          id?: string
          meaning: string
          photo_url?: string | null
          recipient_name: string
          signature_data?: string | null
          signed_at?: string
          stop_id: string
          tenant_id: string
          unsigned_reason?: string | null
        }
        Update: {
          device_id?: string | null
          id?: string
          meaning?: string
          photo_url?: string | null
          recipient_name?: string
          signature_data?: string | null
          signed_at?: string
          stop_id?: string
          tenant_id?: string
          unsigned_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proofs_of_delivery_stop_id_fkey"
            columns: ["stop_id"]
            isOneToOne: false
            referencedRelation: "delivery_stops"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proofs_of_delivery_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      requisition_lines: {
        Row: {
          created_at: string
          id: string
          product_id: string
          qty_allocated: number | null
          qty_requested: number
          requisition_id: string
          shortage_qty: number | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          qty_allocated?: number | null
          qty_requested: number
          requisition_id: string
          shortage_qty?: number | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          qty_allocated?: number | null
          qty_requested?: number
          requisition_id?: string
          shortage_qty?: number | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "requisition_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisition_lines_requisition_id_fkey"
            columns: ["requisition_id"]
            isOneToOne: false
            referencedRelation: "requisitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisition_lines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      requisitions: {
        Row: {
          code: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          facility_id: string
          id: string
          justification: string | null
          requested_at: string
          requested_by: string | null
          status: string
          submitted_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          facility_id: string
          id?: string
          justification?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: string
          submitted_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          facility_id?: string
          id?: string
          justification?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: string
          submitted_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "requisitions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisitions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisitions_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requisitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_balances: {
        Row: {
          batch_id: string
          location_id: string
          product_id: string
          qty_on_hand: number
          qty_reserved: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          batch_id: string
          location_id: string
          product_id: string
          qty_on_hand?: number
          qty_reserved?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          batch_id?: string
          location_id?: string
          product_id?: string
          qty_on_hand?: number
          qty_reserved?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_ledger: {
        Row: {
          actor_user_id: string | null
          batch_id: string
          created_at: string
          facility_id: string
          id: number
          location_id: string
          notes: string | null
          occurred_at: string
          product_id: string
          qty_delta: number
          reason_code: string | null
          reference_id: string | null
          reference_type: string | null
          serial_id: string | null
          tenant_id: string
          txn_type:
            | "RECEIPT"
            | "TRANSFER_IN"
            | "COUNT_GAIN"
            | "RECALL_RELEASE"
            | "ISSUE"
            | "DISPENSE"
            | "TRANSFER_OUT"
            | "COUNT_LOSS"
            | "WRITE_OFF"
            | "RECALL_QUARANTINE"
            | "ADJUSTMENT"
            | "RETURN"
          unit_cost_minor: number | null
        }
        Insert: {
          actor_user_id?: string | null
          batch_id: string
          created_at?: string
          facility_id: string
          id?: never
          location_id: string
          notes?: string | null
          occurred_at?: string
          product_id: string
          qty_delta: number
          reason_code?: string | null
          reference_id?: string | null
          reference_type?: string | null
          serial_id?: string | null
          tenant_id: string
          txn_type:
            | "RECEIPT"
            | "TRANSFER_IN"
            | "COUNT_GAIN"
            | "RECALL_RELEASE"
            | "ISSUE"
            | "DISPENSE"
            | "TRANSFER_OUT"
            | "COUNT_LOSS"
            | "WRITE_OFF"
            | "RECALL_QUARANTINE"
            | "ADJUSTMENT"
            | "RETURN"
          unit_cost_minor?: number | null
        }
        Update: {
          actor_user_id?: string | null
          batch_id?: string
          created_at?: string
          facility_id?: string
          id?: never
          location_id?: string
          notes?: string | null
          occurred_at?: string
          product_id?: string
          qty_delta?: number
          reason_code?: string | null
          reference_id?: string | null
          reference_type?: string | null
          serial_id?: string | null
          tenant_id?: string
          txn_type?:
            | "RECEIPT"
            | "TRANSFER_IN"
            | "COUNT_GAIN"
            | "RECALL_RELEASE"
            | "ISSUE"
            | "DISPENSE"
            | "TRANSFER_OUT"
            | "COUNT_LOSS"
            | "WRITE_OFF"
            | "RECALL_QUARANTINE"
            | "ADJUSTMENT"
            | "RETURN"
          unit_cost_minor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_ledger_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_locations: {
        Row: {
          code: string
          created_at: string
          facility_id: string
          id: string
          is_active: boolean
          kind:
            | "RECEIVING"
            | "QUARANTINE"
            | "AMBIENT"
            | "COLD"
            | "FREEZER"
            | "IN_TRANSIT"
            | "BIN"
            | "DISPENSE"
          name_ar: string
          name_en: string
          temp_max_c: number | null
          temp_min_c: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          facility_id: string
          id?: string
          is_active?: boolean
          kind:
            | "RECEIVING"
            | "QUARANTINE"
            | "AMBIENT"
            | "COLD"
            | "FREEZER"
            | "IN_TRANSIT"
            | "BIN"
            | "DISPENSE"
          name_ar: string
          name_en: string
          temp_max_c?: number | null
          temp_min_c?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          facility_id?: string
          id?: string
          is_active?: boolean
          kind?:
            | "RECEIVING"
            | "QUARANTINE"
            | "AMBIENT"
            | "COLD"
            | "FREEZER"
            | "IN_TRANSIT"
            | "BIN"
            | "DISPENSE"
          name_ar?: string
          name_en?: string
          temp_max_c?: number | null
          temp_min_c?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_locations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          country_code: string
          created_at: string
          currency_code: string
          id: string
          locale_default: string
          min_shelf_life_pct: number
          name_ar: string | null
          name_en: string
          settings: Json
          slug: string
          timezone: string
          updated_at: string
          vat_rate: number
        }
        Insert: {
          country_code?: string
          created_at?: string
          currency_code?: string
          id?: string
          locale_default?: string
          min_shelf_life_pct?: number
          name_ar?: string | null
          name_en: string
          settings?: Json
          slug: string
          timezone?: string
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          country_code?: string
          created_at?: string
          currency_code?: string
          id?: string
          locale_default?: string
          min_shelf_life_pct?: number
          name_ar?: string | null
          name_en?: string
          settings?: Json
          slug?: string
          timezone?: string
          updated_at?: string
          vat_rate?: number
        }
        Relationships: []
      }
      trips: {
        Row: {
          created_at: string
          driver_id: string | null
          ended_at: string | null
          id: string
          notes: string | null
          run_date: string
          started_at: string | null
          status:
            | "PLANNED"
            | "DISPATCHED"
            | "IN_TRANSIT"
            | "COMPLETED"
            | "CANCELLED"
          tenant_id: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          driver_id?: string | null
          ended_at?: string | null
          id?: string
          notes?: string | null
          run_date: string
          started_at?: string | null
          status?:
            | "PLANNED"
            | "DISPATCHED"
            | "IN_TRANSIT"
            | "COMPLETED"
            | "CANCELLED"
          tenant_id: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          driver_id?: string | null
          ended_at?: string | null
          id?: string
          notes?: string | null
          run_date?: string
          started_at?: string | null
          status?:
            | "PLANNED"
            | "DISPATCHED"
            | "IN_TRANSIT"
            | "COMPLETED"
            | "CANCELLED"
          tenant_id?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trips_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          plate_number: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          plate_number?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          plate_number?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_expiry_report: {
        Row: {
          batch_id: string | null
          days_to_expiry: number | null
          expiry_band: string | null
          expiry_date: string | null
          facility_id: string | null
          location_id: string | null
          lot_number: string | null
          name_ar: string | null
          name_en: string | null
          product_id: string | null
          qty_available: number | null
          qty_on_hand: number | null
          sku: string | null
          stock_value_minor: number | null
          tenant_id: string | null
          unit_cost_minor: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_locations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      v_inventory_by_batch: {
        Row: {
          batch_id: string | null
          batch_status:
            | "QUARANTINED"
            | "RELEASED"
            | "RECALLED"
            | "EXPIRED"
            | "DEPLETED"
            | null
          days_to_expiry: number | null
          expiry_date: string | null
          facility_id: string | null
          location_code: string | null
          location_id: string | null
          location_kind:
            | "RECEIVING"
            | "QUARANTINE"
            | "AMBIENT"
            | "COLD"
            | "FREEZER"
            | "IN_TRANSIT"
            | "BIN"
            | "DISPENSE"
            | null
          lot_number: string | null
          mfg_date: string | null
          product_id: string | null
          qty_available: number | null
          qty_on_hand: number | null
          qty_reserved: number | null
          stock_value_minor: number | null
          tenant_id: string | null
          unit_cost_minor: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_locations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      v_inventory_by_product: {
        Row: {
          batch_count: number | null
          days_to_earliest_expiry: number | null
          earliest_expiry: string | null
          facility_id: string | null
          location_id: string | null
          product_id: string | null
          qty_available: number | null
          qty_on_hand: number | null
          qty_reserved: number | null
          released_batches: number | null
          stock_value_minor: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_locations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
        ]
      }
      v_product_stock_total: {
        Row: {
          days_to_earliest_expiry: number | null
          earliest_expiry: string | null
          product_id: string | null
          qty_available: number | null
          qty_on_hand: number | null
          qty_reserved: number | null
          stock_value_minor: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_stock_valuation: {
        Row: {
          avg_unit_cost_minor: number | null
          name_ar: string | null
          name_en: string | null
          product_id: string | null
          qty_on_hand: number | null
          sku: string | null
          tenant_id: string | null
          value_minor: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      [_ in never]: never
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
  api: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
