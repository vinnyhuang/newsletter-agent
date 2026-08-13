CREATE TABLE "agent_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"run_step_id" uuid,
	"agent_name" text NOT NULL,
	"model" text NOT NULL,
	"is_error" boolean DEFAULT false NOT NULL,
	"result_subtype" text,
	"num_turns" integer,
	"duration_ms" integer,
	"model_usage" jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_tokens" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(12, 6),
	"langfuse_trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step_name" text NOT NULL,
	"unit_key" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"queue_wait_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "run_steps_status_check" CHECK ("run_steps"."status" in ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "runs_status_check" CHECK ("runs"."status" in ('running', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "agent_calls" ADD CONSTRAINT "agent_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_calls" ADD CONSTRAINT "agent_calls_run_step_id_run_steps_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_calls_run_idx" ON "agent_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_calls_run_step_idx" ON "agent_calls" USING btree ("run_step_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_steps_run_step_unit_uq" ON "run_steps" USING btree ("run_id","step_name","unit_key");--> statement-breakpoint
CREATE INDEX "run_steps_run_status_idx" ON "run_steps" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "runs_week_started_idx" ON "runs" USING btree ("week_id","started_at" DESC NULLS LAST);