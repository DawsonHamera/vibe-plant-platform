import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { DiagramSnapshotDto } from "./dto/diagram-snapshot.dto";
import { DiagramScopeParamDto } from "./dto/diagram-scope-param.dto";
import { DiagramSnapshotRecord, DiagramsService } from "./diagrams.service";

@Controller("diagrams")
export class DiagramsController {
  constructor(private readonly diagramsService: DiagramsService) {}

  @Get(":scope")
  getSnapshot(@Param() params: DiagramScopeParamDto): DiagramSnapshotRecord {
    return this.diagramsService.getSnapshot(params.scope);
  }

  @Put(":scope")
  upsertSnapshot(
    @Param() params: DiagramScopeParamDto,
    @Body() payload: DiagramSnapshotDto,
  ): DiagramSnapshotRecord {
    return this.diagramsService.upsertSnapshot(params.scope, payload);
  }
}
