CREATE TYPE "public"."assignee_type" AS ENUM('none', 'staff', 'contractor');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('pendingInvite', 'pendingApplication', 'active', 'rejected', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."deliverable_frequency" AS ENUM('daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."deliverable_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."deliverable_type" AS ENUM('text', 'document', 'image');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('unpaid', 'paid', 'dispatched', 'processing', 'processingByPaypal', 'processingByWire', 'processingByPayoneer', 'processingByStripe', 'received');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('scheduled', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('system', 'text', 'image', 'video', 'document');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('staff_invite', 'agency_invite', 'request_completion', 'proposal', 'payment_failed', 'digital_product', 'cancel_subscription', 'verification', 'task', 'chat', 'partial_refund', 'cancellation_request', 'brand_added_you', 'referral_invite');--> statement-breakpoint
CREATE TYPE "public"."party_side" AS ENUM('brand', 'agency', 'sales');--> statement-breakpoint
CREATE TYPE "public"."payout_as" AS ENUM('admin', 'owner', 'staff', 'contractor');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('stripe', 'paypal', 'payoneer', 'wire');--> statement-breakpoint
CREATE TYPE "public"."payout_status" AS ENUM('upcoming', 'pending', 'processing', 'paid', 'failed', 'dispatched', 'processingByPaypal', 'processingByWire', 'processingByPayoneer', 'processingByStripe', 'received');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('clientBrief', 'upcoming', 'brief', 'allocate', 'production', 'internalApproval', 'revision', 'clientApproval', 'completed');--> statement-breakpoint
CREATE TYPE "public"."proposal_item_type" AS ENUM('service', 'heading', 'custom');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'sent', 'viewed', 'accepted', 'rejected', 'paid', 'expired', 'changeRequested', 'internal');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('pending', 'pendingPayment', 'paid', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."purchase_type" AS ENUM('marketplace', 'proposal');--> statement-breakpoint
CREATE TYPE "public"."service_type" AS ENUM('subscription', 'oneOffService', 'recurringService', 'oneOffProductShips', 'recurringProductShips', 'digitalProduct', 'section');--> statement-breakpoint
CREATE TYPE "public"."staff_permission" AS ENUM('agencyDashboard', 'brandDashboard', 'clients', 'catalog', 'agencyProjects', 'brandProjects', 'manageResources', 'documents', 'resources', 'brandGuidelines', 'invoice', 'subscriptions', 'bankAccount', 'staffManagement', 'rolesAndCommissions', 'manageContractors', 'proposals', 'infin8', 'businessInfo', 'agencyBusinessInfo', 'brandBusinessInfo', 'agencyInfo', 'chat', 'chatWithContractors', 'chatWithStaffs', 'chatWithBrands', 'projectBoard', 'production', 'addBrief', 'allocatePeople', 'approveDeliverable', 'moveToInternalApproval', 'fromClientApprovalToCompleted', 'agencies', 'payments');--> statement-breakpoint
CREATE TYPE "public"."staff_status" AS ENUM('pending', 'active', 'removed');--> statement-breakpoint
CREATE TYPE "public"."staff_type" AS ENUM('agency', 'brand', 'contractor');--> statement-breakpoint
CREATE TYPE "public"."task_category" AS ENUM('inbox', 'todo', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('staffInvitation', 'agencyApproval', 'proposalPending', 'proposalAccepted', 'clientApprovalRequest', 'agencyWorkflowAction', 'connectionRequest', 'componentApproval', 'proposalChangeRequested', 'disciplineRequest', 'resourceApproval', 'manual');--> statement-breakpoint
CREATE TYPE "public"."thread_type" AS ENUM('all', 'you', 'brandAgencyStaff', 'agencyStaff', 'brandStaff', 'brandAgencyPersonal', 'agencyPersonal', 'brandPersonal', 'agencyContractorPersonal', 'platformAdmin', 'interAgency');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('brandOwner', 'agencyOwner', 'individualContractor', 'agencyStaff', 'brandStaff', 'superAdmin');--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"business_name" text NOT NULL,
	"legal_name" text,
	"business_email" text,
	"username" text,
	"website" text,
	"phone" text,
	"address" text,
	"abn" text,
	"logo_url" text,
	"description" text,
	"short_description" text,
	"disciplines" text[],
	"services" text[],
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_sales_agency" boolean DEFAULT false NOT NULL,
	"is_inter_agency" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"rejection_reason" text,
	"allow_explore_other_agencies" boolean DEFAULT true NOT NULL,
	"redirect_briefing_commission_to_bank_account" boolean DEFAULT false NOT NULL,
	"redirect_production_commission_to_bank_account" boolean DEFAULT false NOT NULL,
	"redirect_sales_commission_to_bank_account" boolean DEFAULT false NOT NULL,
	"redirect_internal_approval_commission_to_bank_account" boolean DEFAULT false NOT NULL,
	"briefing_designee_id" uuid,
	"allocation_designee_id" uuid,
	"approval_designee_id" uuid,
	"sales_staff_ids" uuid[],
	"sales_person_commissions" jsonb DEFAULT '{}'::jsonb,
	"production_manager_commission" numeric(6, 3),
	"briefing_manager_commission" numeric(6, 3),
	"internal_approval_commission" numeric(6, 3),
	"infin8_substages" text[],
	"social" jsonb,
	"ammortized_project_count" integer DEFAULT 0,
	"stripe_account_id" text,
	"bank_account_linked" boolean DEFAULT false NOT NULL,
	"active_payout_method" "payout_method",
	"payout_methods" jsonb DEFAULT '{}'::jsonb,
	"ui_preferences" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agency_contractor_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"contractor_id" uuid,
	"pending_email" text,
	"status" "connection_status" DEFAULT 'pendingInvite' NOT NULL,
	"initiated_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "brand_agency_connection_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_agency_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" text NOT NULL,
	"agency_id" uuid NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"business_name" text NOT NULL,
	"legal_name" text,
	"email" text,
	"contact_name" text,
	"website" text,
	"phone" text,
	"address" text,
	"abn" text,
	"industry" text,
	"year_founded" text,
	"target_audience" text,
	"competitors" text,
	"usp" text,
	"brand_values" text,
	"tone_of_voice" text,
	"key_messaging" text,
	"logo_url" text,
	"logo_urls" text[],
	"colors" text[],
	"typography" text[],
	"favourite_service_ids" uuid[],
	"referral_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"sender_name" text,
	"sender_avatar" text,
	"sender_role" text,
	"sender_business_name" text,
	"content" text,
	"type" "message_type" DEFAULT 'text' NOT NULL,
	"file_url" text,
	"file_name" text,
	"thumbnail_url" text,
	"file_size" integer,
	"reply_to_id" uuid,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_thread_members" (
	"thread_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"last_read_message_id" uuid,
	"last_read_at" timestamp with time zone,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_thread_members_thread_id_user_id_pk" PRIMARY KEY("thread_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid,
	"name" text,
	"type" "thread_type" NOT NULL,
	"agency_ids" uuid[],
	"brand_id" uuid,
	"participant_a_id" uuid,
	"participant_b_id" uuid,
	"contractor_id" uuid,
	"created_by" uuid,
	"last_message" text,
	"last_message_at" timestamp with time zone,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contractors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"bio" text,
	"tagline" text,
	"skills" text[],
	"hourly_rate" numeric(14, 2),
	"is_available" boolean DEFAULT true NOT NULL,
	"resume_url" text,
	"resume_file_name" text,
	"website_url" text,
	"linkedin_url" text,
	"portfolio_items" jsonb DEFAULT '[]'::jsonb,
	"experience_items" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discipline_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discipline" text NOT NULL,
	"agency_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_unsubscribes" (
	"email" text PRIMARY KEY NOT NULL,
	"channels" "notification_channel"[] DEFAULT '{}'::notification_channel[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"brand_id" uuid,
	"agency_id" uuid,
	"agency_ids" uuid[],
	"folder_id" uuid,
	"project_id" uuid,
	"project_title" text,
	"uploaded_by" uuid,
	"agency_who_uploaded" uuid,
	"size" integer,
	"type" text,
	"category" text,
	"source" text,
	"is_private" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"source_type" text,
	"source_id" text,
	"note" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"brand_id" uuid,
	"agency_id" uuid,
	"parent_id" uuid,
	"is_private" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"prodesk_commission" numeric(6, 3),
	"affiliate_commission" numeric(6, 3),
	"agency_commission" numeric(6, 3),
	"sales_commission" numeric(6, 3),
	"default_payment_plans" jsonb DEFAULT '[]'::jsonb,
	"disciplines" text[],
	"services" text[],
	"infin8_stages" jsonb,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "global_settings_singleton" CHECK ("global_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"name" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"total_price" numeric(14, 2) DEFAULT '0' NOT NULL,
	"package_name" text,
	"selected_options" jsonb DEFAULT '{}'::jsonb,
	"selected_addons" jsonb DEFAULT '[]'::jsonb
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED BY DEFAULT AS IDENTITY (sequence name "invoices_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"purchase_id" uuid,
	"payout_id" uuid,
	"cycle" integer DEFAULT 0,
	"commission_type" text,
	"status" "invoice_status" DEFAULT 'unpaid' NOT NULL,
	"from_party" jsonb,
	"to_party" jsonb,
	"total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid,
	"agency_id" uuid,
	"brand_id" uuid,
	"brand_user_id" uuid,
	"assignee_user_id" uuid,
	"service_name" text,
	"assignee_name" text,
	"brand_user_name" text,
	"brand_user_email" text,
	"google_event_id" text,
	"meet_url" text,
	"status" "meeting_status" DEFAULT 'scheduled' NOT NULL,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"image_url" text,
	"image_path" text,
	"image_aspect_ratio" double precision,
	"video_url" text,
	"video_path" text,
	"disciplines" text[],
	"allow_buy_now" boolean DEFAULT true NOT NULL,
	"allow_book_meeting" boolean DEFAULT false NOT NULL,
	"allow_sales_proposal" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0,
	"items" jsonb DEFAULT '[]'::jsonb,
	"assigned_staff" jsonb DEFAULT '[]'::jsonb,
	"sales_person_commissions" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payout_breakdowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"project_id" uuid,
	"purchase_id" uuid,
	"brand_id" uuid,
	"description" text,
	"commission_type" text,
	"role" text,
	"source_service_name" text,
	"amount" numeric(14, 2) NOT NULL,
	"gst" numeric(14, 2),
	"week" integer,
	"metadata" jsonb,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"paid_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'AUD' NOT NULL,
	"beneficiary_id" uuid NOT NULL,
	"agency_id" uuid,
	"purchase_id" uuid,
	"status" "payout_status" DEFAULT 'upcoming' NOT NULL,
	"as" "payout_as",
	"method" "payout_method",
	"source_brand_name" text,
	"transaction_id" text,
	"wise_funding" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"to_pay_at" timestamp with time zone,
	"completely_paid_at" timestamp with time zone,
	CONSTRAINT "payouts_paid_lte_amount" CHECK ("payouts"."paid_amount" <= "payouts"."amount")
);
--> statement-breakpoint
CREATE TABLE "project_deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "deliverable_type" DEFAULT 'document' NOT NULL,
	"content" text,
	"file_name" text,
	"description" text,
	"status" "deliverable_status" DEFAULT 'pending' NOT NULL,
	"source" "party_side",
	"uploaded_by" uuid,
	"reviewed_by" uuid,
	"rejection_reason" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"content" text NOT NULL,
	"author_id" uuid,
	"author_name" text,
	"author_role" "party_side",
	"source" "party_side",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"content" text,
	"attachment_urls" text[],
	"author_id" uuid,
	"author_name" text,
	"author_role" "party_side",
	"source" "party_side",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"task_title" text,
	"description" text,
	"purchase_id" uuid,
	"purchase_item_id" uuid,
	"stripe_subscription_item_id" text,
	"brand_id" uuid,
	"brand_name" text,
	"agency_id" uuid,
	"service_id" uuid,
	"service_name" text,
	"service_type" "service_type",
	"package_id" uuid,
	"package_name" text,
	"proposal_sent_by_id" uuid,
	"proposal_sent_by_agency_id" uuid,
	"status" "project_status" DEFAULT 'upcoming' NOT NULL,
	"assignee_type" "assignee_type" DEFAULT 'none' NOT NULL,
	"production_assignee_id" uuid,
	"viewable_to_brand" boolean DEFAULT true NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"amount" jsonb,
	"contractor_budget" numeric(14, 2),
	"contractor_budget_note" text,
	"estimated_contractor_duration_in_hours" double precision,
	"brief_context" text,
	"tags" text[],
	"attachments" text[],
	"brief_documents" jsonb DEFAULT '[]'::jsonb,
	"brand_workspace_notes" jsonb DEFAULT '[]'::jsonb,
	"custom_field_responses" jsonb DEFAULT '[]'::jsonb,
	"payment_plans" jsonb DEFAULT '[]'::jsonb,
	"selected_payment_plan" jsonb,
	"commissions" jsonb,
	"selected_variant_id" text,
	"selected_options" jsonb,
	"selected_addons" jsonb DEFAULT '[]'::jsonb,
	"upfront_project_config" jsonb,
	"recurring_project_config" jsonb,
	"deliverable_frequency" "deliverable_frequency",
	"repeats_every" integer,
	"cycle_count" integer DEFAULT 0,
	"revision_count" integer DEFAULT 0,
	"client_revision_count" integer DEFAULT 0,
	"revision_note" text,
	"revision_comments" text[],
	"revision_attachment_url" text,
	"revision_attachment_urls" text[],
	"proposed_refund_amount" numeric(14, 2),
	"upfront_delivery_fee" numeric(14, 2),
	"recurring_delivery_fee" numeric(14, 2),
	"deadline" timestamp with time zone,
	"next_cycle_at" timestamp with time zone,
	"approved_by" text,
	"approval_method" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"soft_delete_expiry" timestamp with time zone,
	"soft_delete_token" text,
	"completion_expiry" timestamp with time zone,
	"completion_token" text
);
--> statement-breakpoint
CREATE TABLE "proposal_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"author_id" uuid,
	"author_name" text,
	"author_role" "party_side",
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"url" text NOT NULL,
	"file_name" text,
	"file_type" text,
	"file_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"phase_id" uuid,
	"type" "proposal_item_type" DEFAULT 'service' NOT NULL,
	"service_id" uuid,
	"package_id" uuid,
	"agency_id" uuid,
	"description" text,
	"heading_text" text,
	"amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"upfront_fee" numeric(14, 2),
	"upfront_delivery_fee" numeric(14, 2),
	"recurring_delivery_fee" numeric(14, 2),
	"is_recurring" boolean DEFAULT false NOT NULL,
	"billing_cycle" text,
	"service_type" "service_type",
	"deliverable_frequency" "deliverable_frequency",
	"repeats_every" integer,
	"project_duration_days" integer,
	"is_optional" boolean DEFAULT false NOT NULL,
	"is_excluded_by_brand" boolean DEFAULT false NOT NULL,
	"removal_proposed_by_brand" boolean DEFAULT false NOT NULL,
	"selected_variant_id" text,
	"selected_options" jsonb DEFAULT '{}'::jsonb,
	"selected_addons" jsonb DEFAULT '[]'::jsonb,
	"commissions" jsonb,
	"upfront_project_config" jsonb,
	"recurring_project_config" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"start_delay_days" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid,
	"brand_id" uuid,
	"title" text,
	"description" text,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"proposal_sent_by_id" uuid,
	"proposal_sent_by_agency_id" uuid,
	"created_by_sales_agency_id" uuid,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"is_billable" boolean DEFAULT true NOT NULL,
	"agency_ids" uuid[],
	"agency_snapshot" jsonb,
	"brand_snapshot" jsonb,
	"terms_and_conditions" text,
	"payment_terms" text,
	"validity_days" integer,
	"internal_notes" text,
	"client_notes" text,
	"change_request_note" text,
	"selected_payment_plan" jsonb,
	"payment_method" text,
	"payment_reference" text,
	"invoice_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "purchase_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"service_id" uuid,
	"package_id" uuid,
	"agency_id" uuid,
	"proposal_item_id" uuid,
	"project_id" uuid,
	"service_name" text,
	"service_type" "service_type",
	"description" text,
	"heading_text" text,
	"amount" jsonb,
	"line_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"project_duration_days" integer,
	"deliverable_frequency" "deliverable_frequency",
	"digital_product_file_url" text,
	"digital_product_file_name" text,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"is_excluded_by_brand" boolean DEFAULT false NOT NULL,
	"selected_variant_id" text,
	"selected_options" jsonb DEFAULT '{}'::jsonb,
	"selected_addons" jsonb DEFAULT '[]'::jsonb,
	"repeats_every" integer,
	"commissions" jsonb,
	"sales_person_commissions" jsonb DEFAULT '{}'::jsonb,
	"upfront_project_config" jsonb,
	"recurring_project_config" jsonb,
	"upfront_delivery_fee" numeric(14, 2),
	"recurring_delivery_fee" numeric(14, 2),
	"phase_id" uuid,
	"start_delay_days" integer,
	"stripe_subscription_item_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"user_id" uuid,
	"type" "purchase_type" DEFAULT 'marketplace' NOT NULL,
	"status" "purchase_status" DEFAULT 'pending' NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"proposal_id" uuid,
	"proposal_sent_by_id" uuid,
	"proposal_sent_by_agency_id" uuid,
	"custom_field_responses" jsonb DEFAULT '{}'::jsonb,
	"payment_plans" jsonb DEFAULT '[]'::jsonb,
	"selected_payment_plan" jsonb,
	"amount" jsonb,
	"total_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"agency_commission" numeric(14, 2),
	"affiliate_commission" numeric(14, 2),
	"prodesk_commission" numeric(14, 2),
	"sales_commission" numeric(14, 2),
	"payment_count" integer DEFAULT 0 NOT NULL,
	"payment_received" numeric(14, 2) DEFAULT '0' NOT NULL,
	"stripe_session_id" text,
	"stripe_payment_intent_id" text,
	"stripe_subscription_id" text,
	"stripe_customer_id" text,
	"stripe_url" text,
	"viewable_to_brand" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text,
	"link_url" text,
	"categories" text[],
	"agency_id" uuid,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "service_type" DEFAULT 'oneOffService' NOT NULL,
	"price" numeric(14, 2),
	"upfront_fee" numeric(14, 2),
	"recurring_fee" numeric(14, 2),
	"upfront_delivery_fee" numeric(14, 2),
	"recurring_delivery_fee" numeric(14, 2),
	"image_url" text,
	"image_path" text,
	"image_aspect_ratio" double precision,
	"video_url" text,
	"video_path" text,
	"stage" text,
	"sub_stage" text,
	"disciplines" text[],
	"allow_buy_now" boolean DEFAULT true NOT NULL,
	"allow_book_meeting" boolean DEFAULT false NOT NULL,
	"allow_sales_proposal" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deliverable_frequency" "deliverable_frequency",
	"repeats_every" integer,
	"sort_order" integer DEFAULT 0,
	"is_heading" boolean DEFAULT false NOT NULL,
	"heading_text" text,
	"digital_product_file_url" text,
	"digital_product_file_name" text,
	"custom_fields" jsonb DEFAULT '[]'::jsonb,
	"assigned_staff" jsonb DEFAULT '[]'::jsonb,
	"options" jsonb DEFAULT '[]'::jsonb,
	"variants" jsonb DEFAULT '[]'::jsonb,
	"addons" jsonb DEFAULT '[]'::jsonb,
	"upfront_project_config" jsonb,
	"recurring_project_config" jsonb,
	"sales_person_commissions" jsonb DEFAULT '{}'::jsonb,
	"production_manager_commission" numeric(6, 3),
	"briefing_manager_commission" numeric(6, 3),
	"internal_approval_commission" numeric(6, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spot_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid,
	"template_name" text NOT NULL,
	"agency_id" uuid,
	"brand_id" uuid NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb,
	"answers" jsonb DEFAULT '{}'::jsonb,
	"is_public" boolean DEFAULT false NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"question_order" text[],
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spot_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid,
	"brand_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"questions" jsonb DEFAULT '[]'::jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"type" "staff_type" NOT NULL,
	"agency_id" uuid,
	"brand_id" uuid,
	"user_id" uuid,
	"display_name" text,
	"permissions" "staff_permission"[] DEFAULT '{}'::staff_permission[] NOT NULL,
	"status" "staff_status" DEFAULT 'pending' NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_one_org" CHECK (num_nonnulls("staff"."agency_id", "staff"."brand_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "task_type" NOT NULL,
	"category" "task_category" DEFAULT 'inbox' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_id" uuid,
	"assigned_by" text DEFAULT 'system',
	"sort_order" double precision DEFAULT 0,
	"related_entity_id" uuid,
	"organization_id" uuid,
	"organization_name" text,
	"agency_name" text,
	"brand_name" text,
	"project_id" uuid,
	"proposal_id" uuid,
	"visible_to" uuid[],
	"disable_mailing" boolean DEFAULT false NOT NULL,
	"attachments" text[],
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_agencies" (
	"user_id" uuid NOT NULL,
	"agency_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_agencies_user_id_agency_id_pk" PRIMARY KEY("user_id","agency_id")
);
--> statement-breakpoint
CREATE TABLE "user_brands" (
	"user_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_brands_user_id_brand_id_pk" PRIMARY KEY("user_id","brand_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"role" "user_role",
	"first_name" text,
	"last_name" text,
	"profile_url" text,
	"selected_agency_id" uuid,
	"selected_brand_id" uuid,
	"referred_by_user_id" uuid,
	"referred_by_agency_id" uuid,
	"is_email_verified" boolean DEFAULT false NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"stripe_account_id" text,
	"bank_account_linked" boolean DEFAULT false NOT NULL,
	"active_payout_method" "payout_method",
	"payout_methods" jsonb DEFAULT '{}'::jsonb,
	"ui_preferences" jsonb DEFAULT '{}'::jsonb,
	"custom_data" jsonb DEFAULT '{}'::jsonb,
	"google_calendar_linked" boolean DEFAULT false NOT NULL,
	"google_calendar_token" jsonb,
	"last_tasks_viewed_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_contractor_connections" ADD CONSTRAINT "agency_contractor_connections_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_contractor_connections" ADD CONSTRAINT "agency_contractor_connections_contractor_id_users_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_contractor_connections" ADD CONSTRAINT "agency_contractor_connections_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_agency_connection_requests" ADD CONSTRAINT "brand_agency_connection_requests_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_agency_connection_requests" ADD CONSTRAINT "brand_agency_connection_requests_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_agency_connection_requests" ADD CONSTRAINT "brand_agency_connection_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_agency_connections" ADD CONSTRAINT "brand_agency_connections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_agency_connections" ADD CONSTRAINT "brand_agency_connections_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_referrals" ADD CONSTRAINT "brand_referrals_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_thread_members" ADD CONSTRAINT "chat_thread_members_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_thread_members" ADD CONSTRAINT "chat_thread_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_connection_id_brand_agency_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."brand_agency_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_participant_a_id_users_id_fk" FOREIGN KEY ("participant_a_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_participant_b_id_users_id_fk" FOREIGN KEY ("participant_b_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_contractor_id_users_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discipline_requests" ADD CONSTRAINT "discipline_requests_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "global_settings" ADD CONSTRAINT "global_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_brand_user_id_users_id_fk" FOREIGN KEY ("brand_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_breakdowns" ADD CONSTRAINT "payout_breakdowns_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_breakdowns" ADD CONSTRAINT "payout_breakdowns_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_breakdowns" ADD CONSTRAINT "payout_breakdowns_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_breakdowns" ADD CONSTRAINT "payout_breakdowns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_beneficiary_id_users_id_fk" FOREIGN KEY ("beneficiary_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_deliverables" ADD CONSTRAINT "project_deliverables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_deliverables" ADD CONSTRAINT "project_deliverables_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_deliverables" ADD CONSTRAINT "project_deliverables_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_notes" ADD CONSTRAINT "project_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_revisions" ADD CONSTRAINT "project_revisions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_revisions" ADD CONSTRAINT "project_revisions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_proposal_sent_by_id_users_id_fk" FOREIGN KEY ("proposal_sent_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_proposal_sent_by_agency_id_agencies_id_fk" FOREIGN KEY ("proposal_sent_by_agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_production_assignee_id_users_id_fk" FOREIGN KEY ("production_assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_comments" ADD CONSTRAINT "proposal_comments_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_comments" ADD CONSTRAINT "proposal_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_documents" ADD CONSTRAINT "proposal_documents_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_phase_id_proposal_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."proposal_phases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_phases" ADD CONSTRAINT "proposal_phases_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_proposal_sent_by_id_users_id_fk" FOREIGN KEY ("proposal_sent_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_proposal_sent_by_agency_id_agencies_id_fk" FOREIGN KEY ("proposal_sent_by_agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_sales_agency_id_agencies_id_fk" FOREIGN KEY ("created_by_sales_agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_proposal_sent_by_id_users_id_fk" FOREIGN KEY ("proposal_sent_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_proposal_sent_by_agency_id_agencies_id_fk" FOREIGN KEY ("proposal_sent_by_agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_components" ADD CONSTRAINT "spot_components_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_components" ADD CONSTRAINT "spot_components_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_components" ADD CONSTRAINT "spot_components_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_forms" ADD CONSTRAINT "spot_forms_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spot_forms" ADD CONSTRAINT "spot_forms_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_agencies" ADD CONSTRAINT "user_agencies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_agencies" ADD CONSTRAINT "user_agencies_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_brands" ADD CONSTRAINT "user_brands_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_brands" ADD CONSTRAINT "user_brands_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_selected_agency_id_agencies_id_fk" FOREIGN KEY ("selected_agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_selected_brand_id_brands_id_fk" FOREIGN KEY ("selected_brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_user_id_users_id_fk" FOREIGN KEY ("referred_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_agency_id_agencies_id_fk" FOREIGN KEY ("referred_by_agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agencies_username_lower_idx" ON "agencies" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "agencies_owner_idx" ON "agencies" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_contractor_uniq" ON "agency_contractor_connections" USING btree ("agency_id","contractor_id") WHERE "agency_contractor_connections"."contractor_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_contractor_email_uniq" ON "agency_contractor_connections" USING btree ("agency_id","pending_email") WHERE "agency_contractor_connections"."pending_email" is not null;--> statement-breakpoint
CREATE INDEX "agency_contractor_contractor_idx" ON "agency_contractor_connections" USING btree ("contractor_id");--> statement-breakpoint
CREATE INDEX "agency_contractor_status_idx" ON "agency_contractor_connections" USING btree ("agency_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_agency_req_uniq" ON "brand_agency_connection_requests" USING btree ("brand_id","agency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brand_agency_uniq" ON "brand_agency_connections" USING btree ("brand_id","agency_id");--> statement-breakpoint
CREATE INDEX "brand_agency_agency_idx" ON "brand_agency_connections" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "brand_referrals_agency_idx" ON "brand_referrals" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "brands_owner_idx" ON "brands" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "chat_messages_thread_idx" ON "chat_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_thread_members_user_idx" ON "chat_thread_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_threads_connection_idx" ON "chat_threads" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "chat_threads_last_message_idx" ON "chat_threads" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "contractors_skills_idx" ON "contractors" USING gin ("skills");--> statement-breakpoint
CREATE INDEX "discipline_requests_agency_idx" ON "discipline_requests" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "files_brand_idx" ON "files" USING btree ("brand_id") WHERE "files"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "files_folder_idx" ON "files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "files_project_idx" ON "files" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "files_source_uniq" ON "files" USING btree ("source_type","source_id") WHERE "files"."source_type" is not null;--> statement-breakpoint
CREATE INDEX "folders_brand_idx" ON "folders" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_purchase_idx" ON "invoices" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meetings_assignee_time_idx" ON "meetings" USING btree ("assignee_user_id","start_time");--> statement-breakpoint
CREATE INDEX "packages_agency_live_idx" ON "packages" USING btree ("agency_id") WHERE "packages"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "payout_breakdowns_payout_idx" ON "payout_breakdowns" USING btree ("payout_id");--> statement-breakpoint
CREATE INDEX "payout_breakdowns_project_idx" ON "payout_breakdowns" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "payouts_beneficiary_idx" ON "payouts" USING btree ("beneficiary_id");--> statement-breakpoint
CREATE INDEX "payouts_due_idx" ON "payouts" USING btree ("status","to_pay_at");--> statement-breakpoint
CREATE INDEX "project_deliverables_project_idx" ON "project_deliverables" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_deliverables_pending_idx" ON "project_deliverables" USING btree ("project_id") WHERE "project_deliverables"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "project_notes_project_idx" ON "project_notes" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_revisions_project_idx" ON "project_revisions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "projects_brand_status_idx" ON "projects" USING btree ("brand_id","status") WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "projects_agency_status_idx" ON "projects" USING btree ("agency_id","status") WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "projects_assignee_idx" ON "projects" USING btree ("production_assignee_id") WHERE "projects"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "projects_purchase_idx" ON "projects" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "projects_next_cycle_idx" ON "projects" USING btree ("next_cycle_at") WHERE "projects"."next_cycle_at" is not null;--> statement-breakpoint
CREATE INDEX "proposal_comments_proposal_idx" ON "proposal_comments" USING btree ("proposal_id","created_at");--> statement-breakpoint
CREATE INDEX "proposal_documents_proposal_idx" ON "proposal_documents" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "proposal_items_proposal_idx" ON "proposal_items" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "proposal_items_service_idx" ON "proposal_items" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "proposal_phases_proposal_idx" ON "proposal_phases" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "proposals_agency_status_idx" ON "proposals" USING btree ("agency_id","status");--> statement-breakpoint
CREATE INDEX "proposals_brand_status_idx" ON "proposals" USING btree ("brand_id","status");--> statement-breakpoint
CREATE INDEX "purchase_items_purchase_idx" ON "purchase_items" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_items_service_idx" ON "purchase_items" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "purchases_brand_idx" ON "purchases" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "purchases_user_idx" ON "purchases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "purchases_status_idx" ON "purchases" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_stripe_session_uniq" ON "purchases" USING btree ("stripe_session_id") WHERE "purchases"."stripe_session_id" is not null;--> statement-breakpoint
CREATE INDEX "resources_agency_idx" ON "resources" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "services_agency_live_idx" ON "services" USING btree ("agency_id","sort_order") WHERE "services"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "spot_components_brand_idx" ON "spot_components" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "spot_components_template_idx" ON "spot_components" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "spot_forms_agency_idx" ON "spot_forms" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "spot_forms_brand_idx" ON "spot_forms" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "staff_agency_idx" ON "staff" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "staff_brand_idx" ON "staff" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "staff_user_idx" ON "staff" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_category_idx" ON "tasks" USING btree ("assignee_id","category");--> statement-breakpoint
CREATE INDEX "tasks_visible_to_idx" ON "tasks" USING gin ("visible_to");--> statement-breakpoint
CREATE INDEX "user_agencies_agency_idx" ON "user_agencies" USING btree ("agency_id");--> statement-breakpoint
CREATE INDEX "user_brands_brand_idx" ON "user_brands" USING btree ("brand_id");