-- Remove the deprecated 'signaturesViewer' staff permission entirely.
-- Signatures is a single MANAGE permission ('signatures'); the viewer value was
-- added in 0049 and deprecated in the signatures permission refactor. Postgres
-- has no ALTER TYPE ... DROP VALUE, so: strip it from every row, then recreate
-- the enum without it (staff.permissions is the only column using the type).
UPDATE "staff" SET "permissions" = array_remove("permissions", 'signaturesViewer'::"staff_permission")
WHERE 'signaturesViewer' = ANY("permissions");--> statement-breakpoint
ALTER TYPE "public"."staff_permission" RENAME TO "staff_permission_old";--> statement-breakpoint
CREATE TYPE "public"."staff_permission" AS ENUM (
	'agencyDashboard',
	'brandDashboard',
	'clients',
	'catalog',
	'agencyProjects',
	'brandProjects',
	'manageResources',
	'documents',
	'resources',
	'brandGuidelines',
	'invoice',
	'subscriptions',
	'bankAccount',
	'staffManagement',
	'rolesAndCommissions',
	'manageContractors',
	'proposals',
	'infin8',
	'businessInfo',
	'agencyBusinessInfo',
	'brandBusinessInfo',
	'agencyInfo',
	'chat',
	'chatWithContractors',
	'chatWithStaffs',
	'chatWithBrands',
	'projectBoard',
	'production',
	'addBrief',
	'allocatePeople',
	'approveDeliverable',
	'moveToInternalApproval',
	'fromClientApprovalToCompleted',
	'agencies',
	'payments',
	'links',
	'linksViewer',
	'reviews',
	'reviewsViewer',
	'paymentsViewer',
	'signatures'
);--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "permissions" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "permissions" SET DATA TYPE "public"."staff_permission"[] USING "permissions"::text[]::"public"."staff_permission"[];--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "permissions" SET DEFAULT '{}'::"public"."staff_permission"[];--> statement-breakpoint
DROP TYPE "public"."staff_permission_old";
