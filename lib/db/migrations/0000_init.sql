CREATE TABLE "users" (
	"id" varchar PRIMARY KEY NOT NULL,
	"name" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"run_id" integer,
	"kind" varchar(30) NOT NULL,
	"skill" varchar(60),
	"summary" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"name" varchar(60),
	"avatar_url" text,
	"avatar_style" varchar(60),
	"vibe" text,
	"emoji" varchar(16),
	"hatched_at" timestamp with time zone,
	"proactivity" varchar(12) DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'Idle' NOT NULL,
	"status_updated_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allowed_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"host" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"run_id" integer,
	"chat_id" integer,
	"tool_name" varchar(60) NOT NULL,
	"action_class" varchar(20) NOT NULL,
	"target" text,
	"purpose" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"grant" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"chat_id" integer,
	"kind" varchar(20) NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browser_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"run_id" integer,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"url" text,
	"title" text,
	"screenshot" text,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"kind" varchar(12) DEFAULT 'side' NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"provider" varchar(60) NOT NULL,
	"display_name" text NOT NULL,
	"custom" boolean DEFAULT false NOT NULL,
	"access" varchar(12) DEFAULT 'read' NOT NULL,
	"approval_mode" varchar(12) DEFAULT 'some' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_id" integer,
	"status" varchar(20) DEFAULT 'connected' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"label" text NOT NULL,
	"kind" varchar(20) DEFAULT 'api_key' NOT NULL,
	"host" text,
	"username" text,
	"secret_enc" text NOT NULL,
	"surrogate" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"progress_note" text,
	"emoji" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"tool_name" varchar(60) NOT NULL,
	"action_class" varchar(20) NOT NULL,
	"target" text,
	"scope" varchar(20) NOT NULL,
	"run_id" integer,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"prompt" text NOT NULL,
	"category" varchar(40) DEFAULT 'general' NOT NULL,
	"emoji" varchar(16),
	"source" varchar(20) DEFAULT 'agent' NOT NULL,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"role" varchar(12) NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"parts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_id" integer,
	"proactive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"chat_id" integer NOT NULL,
	"trigger" varchar(20) DEFAULT 'user' NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"title" text,
	"error" text,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scheduled_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"kind" varchar(20) DEFAULT 'task' NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"interval_minutes" integer,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_result" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"goal_id" integer,
	"space_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"connector_default" varchar(12) DEFAULT 'some' NOT NULL,
	"web_default" varchar(12) DEFAULT 'some' NOT NULL,
	"notifications" boolean DEFAULT true NOT NULL,
	"voice" varchar(30) DEFAULT 'alloy' NOT NULL,
	"timezone" varchar(60) DEFAULT 'America/Los_Angeles' NOT NULL,
	"onboarded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"title" text NOT NULL,
	"emoji" varchar(16),
	"description" text DEFAULT '' NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"placement" varchar(12) DEFAULT 'sidebar' NOT NULL,
	"schedule" jsonb,
	"refresh_prompt" text,
	"last_refreshed_at" timestamp with time zone,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"day" varchar(10) NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"images" integer DEFAULT 0 NOT NULL,
	"audio_seconds" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"path" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"mime_type" varchar(100) DEFAULT 'text/markdown' NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allowed_sites" ADD CONSTRAINT "allowed_sites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_sessions" ADD CONSTRAINT "browser_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage" ADD CONSTRAINT "usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_files" ADD CONSTRAINT "workspace_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_user" ON "activity" USING btree ("user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "allowed_sites_user_host" ON "allowed_sites" USING btree ("user_id","host");--> statement-breakpoint
CREATE INDEX "approvals_user" ON "approvals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "artifacts_user" ON "artifacts" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "chats_user" ON "chats" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connectors_user_provider" ON "connectors" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "credentials_user" ON "credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "goals_user" ON "goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "grants_user" ON "grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ideas_user" ON "ideas" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_chat" ON "messages" USING btree ("chat_id","id");--> statement-breakpoint
CREATE INDEX "notifications_user" ON "notifications" USING btree ("user_id","read");--> statement-breakpoint
CREATE INDEX "runs_user" ON "runs" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "sched_due" ON "scheduled_tasks" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "spaces_user" ON "spaces" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_user_day" ON "usage" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_files_user_path" ON "workspace_files" USING btree ("user_id","path");