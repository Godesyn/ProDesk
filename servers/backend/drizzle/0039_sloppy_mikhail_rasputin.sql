ALTER TABLE "payment_activity_log" DROP CONSTRAINT "payment_activity_log_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_affiliate_referrals" DROP CONSTRAINT "payment_affiliate_referrals_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_client_surveys" DROP CONSTRAINT "payment_client_surveys_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_email_logs" DROP CONSTRAINT "payment_email_logs_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_installment_schedules" DROP CONSTRAINT "payment_installment_schedules_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_lifecycle_requests" DROP CONSTRAINT "payment_lifecycle_requests_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_outbound_webhook_deliveries" DROP CONSTRAINT "payment_outbound_webhook_deliveries_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_payer_lifecycle_events" DROP CONSTRAINT "payment_payer_lifecycle_events_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_proposal_annotations" DROP CONSTRAINT "payment_proposal_annotations_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_proposal_questions" DROP CONSTRAINT "payment_proposal_questions_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_proposal_revisions" DROP CONSTRAINT "payment_proposal_revisions_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_renewal_reminders" DROP CONSTRAINT "payment_renewal_reminders_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_sequence_runs" DROP CONSTRAINT "payment_sequence_runs_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_sms_messages" DROP CONSTRAINT "payment_sms_messages_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_transactions" DROP CONSTRAINT "payment_transactions_proposal_id_payment_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "payment_activity_log" ADD CONSTRAINT "payment_activity_log_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_affiliate_referrals" ADD CONSTRAINT "payment_affiliate_referrals_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_client_surveys" ADD CONSTRAINT "payment_client_surveys_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_email_logs" ADD CONSTRAINT "payment_email_logs_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installment_schedules" ADD CONSTRAINT "payment_installment_schedules_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lifecycle_requests" ADD CONSTRAINT "payment_lifecycle_requests_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_outbound_webhook_deliveries" ADD CONSTRAINT "payment_outbound_webhook_deliveries_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_payer_lifecycle_events" ADD CONSTRAINT "payment_payer_lifecycle_events_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposal_annotations" ADD CONSTRAINT "payment_proposal_annotations_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposal_questions" ADD CONSTRAINT "payment_proposal_questions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposal_revisions" ADD CONSTRAINT "payment_proposal_revisions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_renewal_reminders" ADD CONSTRAINT "payment_renewal_reminders_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sequence_runs" ADD CONSTRAINT "payment_sequence_runs_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sms_messages" ADD CONSTRAINT "payment_sms_messages_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;