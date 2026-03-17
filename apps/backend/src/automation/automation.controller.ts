import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import {
  AutomationFlowService,
  DiagramApplyResult,
  DiagramPreviewResult,
} from "./automation-flow.service";
import { AutomationRuntimeService } from "./automation-runtime.service";
import { AutomationRule, AutomationService } from "./automation.service";
import { CreateRuleDto } from "./dto/create-rule.dto";
import { DiagramScopeDto } from "./dto/diagram-scope.dto";
import { TimelineQueryDto } from "./dto/timeline-query.dto";

@Controller("automation")
export class AutomationController {
  constructor(
    private readonly automationService: AutomationService,
    private readonly automationRuntime: AutomationRuntimeService,
    private readonly automationFlow: AutomationFlowService,
  ) {}

  @Get("rules")
  rules(): AutomationRule[] {
    return this.automationService.listRules();
  }

  @Post("rules")
  create(@Body() payload: CreateRuleDto): AutomationRule {
    return this.automationService.createRule(payload);
  }

  @Get("timeline")
  timeline(@Query() query: TimelineQueryDto): Array<Record<string, unknown>> {
    return this.automationService.timeline(query);
  }

  @Get("runtime-status")
  runtimeStatus(): {
    lastRunAt: string | null;
    lastExecutionCount: number;
    totalExecutions: number;
    blockedCooldownCount: number;
    blockedDailyLimitCount: number;
  } {
    return this.automationRuntime.getRuntimeStatus();
  }

  @Get("runtime-history")
  runtimeHistory(@Query("limit") limit?: string): Array<{
    ranAt: string;
    executionCount: number;
    blockedCooldownCountDelta: number;
    blockedDailyLimitCountDelta: number;
  }> {
    const parsedLimit = Number.parseInt(limit ?? "20", 10);
    const normalizedLimit = Number.isNaN(parsedLimit) ? 20 : Math.max(1, Math.min(parsedLimit, 200));
    return this.automationRuntime.getRuntimeHistory(normalizedLimit);
  }

  @Post("rules/:id/simulate")
  simulate(@Param("id") id: string): { accepted: boolean; eventId: string } {
    return this.automationService.simulate(id);
  }

  @Patch("rules/:id/enabled")
  setRuleEnabled(
    @Param("id") id: string,
    @Body() payload: { enabled: boolean },
  ): AutomationRule {
    return this.automationService.setRuleEnabled(id, payload.enabled);
  }

  @Post("evaluate")
  evaluate(): { executed: number } {
    return { executed: this.automationRuntime.runEvaluationCycle() };
  }

  @Post("diagram-scopes/:scope/apply")
  applyDiagramScope(@Param() params: DiagramScopeDto): DiagramApplyResult {
    return this.automationFlow.applyDiagramScope(params.scope);
  }

  @Get("diagram-scopes/:scope/preview")
  previewDiagramScope(@Param() params: DiagramScopeDto): DiagramPreviewResult {
    return this.automationFlow.previewDiagramScope(params.scope);
  }
}
