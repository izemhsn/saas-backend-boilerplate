-- CreateTable
CREATE TABLE "failed_jobs" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobData" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "failed_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "failed_jobs_queue_idx" ON "failed_jobs"("queue");

-- CreateIndex
CREATE INDEX "failed_jobs_failedAt_idx" ON "failed_jobs"("failedAt");
