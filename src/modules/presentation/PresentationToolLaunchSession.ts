import type { ToolDefinition } from "../../types/tool";
import type { PresentationSourceContext } from "./contracts";
import type { PresentationLaunchSettings } from "./PresentationLaunchSettings";
import {
  createPresentationLaunchAuthorization,
  type PresentationLaunchAuthorization,
} from "./PresentationLaunchAuthorization";

export const PRESENTATION_LAUNCH_TOOL_NAME = "request_presentation";

export interface PresentationLaunchIntent {
  sourceItemKey?: string;
  sourceLibraryID?: number;
  slideCount?: number;
  designSystem?: string;
  instructions?: string;
}

export interface PresentationLaunchSourceResolution {
  source: PresentationSourceContext;
  settings: PresentationLaunchSettings;
}

export type PresentationLaunchSourceResolver = (
  intent: PresentationLaunchIntent,
) => Promise<PresentationLaunchSourceResolution | null>;

export interface PresentationToolLaunchResult {
  success: boolean;
  message: string;
}

export interface PresentationToolLaunchSession {
  readonly source: PresentationSourceContext;
  getAuthorization(): PresentationLaunchAuthorization | null;
  resolveSource(
    intent: PresentationLaunchIntent,
  ): Promise<PresentationLaunchSourceResolution | null>;
  launch(
    intent: PresentationLaunchIntent,
  ): Promise<PresentationToolLaunchResult>;
  finish(): void;
}

export function createPresentationLaunchToolDefinition(): ToolDefinition {
  return {
    type: "function",
    function: {
      name: PRESENTATION_LAUNCH_TOOL_NAME,
      description: "Disabled in PaperMind fork.",
      parameters: { type: "object", properties: {} },
    },
  };
}

export function createPresentationToolLaunchSession(
  source: PresentationSourceContext,
  settings?: PresentationLaunchSettings,
): PresentationToolLaunchSession {
  const authorization = createPresentationLaunchAuthorization(source, settings);
  return {
    source,
    getAuthorization: () => authorization,
    async resolveSource() {
      return null;
    },
    async launch() {
      return {
        success: false,
        message: "PPT generation is not available.",
      };
    },
    finish() {},
  };
}
