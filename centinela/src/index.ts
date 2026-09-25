import { seedIfNeeded, addIdea, addTicker } from "./universe.ts";
import { startScheduler, runJob, listJobs } from "./jobs.ts";
import { startMqtt, publishTextState } from "./mqtt.ts";
import { startApi, drafts } from "./api.ts";
import { config } from "./config.ts";

seedIfNeeded();

await startMqtt({
  onAddTicker: (s) => {
    try {
      addTicker(s);
      drafts.ticker = "";
      publishTextState(drafts);
    } catch (e) {
      console.error("[ticker]", (e as Error).message);
    }
  },
  onAddIdea: (title, claim, factor) => {
    try {
      addIdea(title, claim, factor || "iran");
      drafts.ideaTitle = "";
      drafts.ideaClaim = "";
      publishTextState(drafts);
    } catch (e) {
      console.error("[idea]", (e as Error).message);
    }
  },
  onRunJob: (id) => {
    void runJob(id);
  },
  drafts,
});

startApi();
startScheduler();

console.log(
  `[centinela] arranque · TZ=${config.tz} · preview=${config.previewUi} · mqtt=${config.mqttUrl || "off"} · jobs=${listJobs().length}`,
);
