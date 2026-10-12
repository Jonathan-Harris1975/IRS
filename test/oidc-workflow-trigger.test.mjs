import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = new URL("../.github/workflows/oidc-readiness.yml", import.meta.url);

test("IRS refreshes OIDC evidence after trusted main verification completes", async () => {
  const source = await readFile(workflow, "utf8");
  const trigger = source.split("on:")[1].split("\npermissions:")[0];
  assert.match(source, /workflow_run: # zizmor: ignore\\[dangerous-triggers\\]/);
  assert.match(trigger, /workflow_run:[\s\S]*workflows: \["Production verification"\][\s\S]*types: \[completed\]/);
  assert.match(source, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(source, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(source, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
});
