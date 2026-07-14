import { Given, Then, When } from "@cucumber/cucumber";

import type { StoryWorld } from "../support/world.js";

Given<StoryWorld>(
  "a person has opened a workspace in a supported web browser",
  { timeout: 30_000 },
  async function () {
    await this.openWebApplicationContentLayout();
  },
);

Given<StoryWorld>(
  "a person has opened a workspace in the desktop IDE",
  { timeout: 30_000 },
  async function () {
    await this.openDesktopApplicationContentLayoutHarness();
  },
);

Given<StoryWorld>(
  /^the application content includes an activity rail, a left sidebar, an editor area, and a bottom shell\/tool-window host$/,
  async function () {
    await this.applicationContentLayoutSession().assertApplicationRegionsAvailable();
  },
);

When<StoryWorld>(
  "the person expands, collapses, and resizes the left sidebar and the bottom panel in turn",
  { timeout: 15_000 },
  async function () {
    const session = this.applicationContentLayoutSession();
    await session.exercisePanelChanges();
    await this.attach(JSON.stringify(session.evidence()), "application/json");
  },
);

Then<StoryWorld>(
  "after every change the activity rail and left sidebar span the full height available to application content",
  function () {
    this.applicationContentLayoutSession().assertFullHeightNavigation();
  },
);

Then<StoryWorld>(
  /^the bottom shell\/tool-window host begins after the left sidebar and occupies only the editor-side width$/,
  function () {
    this.applicationContentLayoutSession().assertEditorSideBottomPanel();
  },
);

Then<StoryWorld>(
  "the top-level chrome and status bar remain separate from application content",
  function () {
    this.applicationContentLayoutSession().assertChromeAndStatusBarSeparate();
  },
);

Then<StoryWorld>(
  "they retain the positions and extents they had before the panel changes",
  function () {
    this.applicationContentLayoutSession().assertChromeAndStatusBarStable();
  },
);

Then<StoryWorld>(
  "keyboard resizing and the existing accessibility semantics of each resizable panel boundary remain available",
  function () {
    this.applicationContentLayoutSession().assertKeyboardResizeAndAccessibility();
  },
);
