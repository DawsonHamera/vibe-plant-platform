import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { AutomationModule } from "./automation/automation.module";
import { AuthMiddleware } from "./auth/auth.middleware";
import { AuthModule } from "./auth/auth.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DatabaseModule } from "./database/database.module";
import { DevicesModule } from "./devices/devices.module";
import { DiagramsModule } from "./diagrams/diagrams.module";
import { PlantsModule } from "./plants/plants.module";
import { TelemetryModule } from "./telemetry/telemetry.module";

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    PlantsModule,
    TelemetryModule,
    DashboardModule,
    DevicesModule,
    DiagramsModule,
    AutomationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(AuthMiddleware)
      .exclude(
        { path: "auth/login", method: RequestMethod.POST },
        { path: "auth/session", method: RequestMethod.GET },
        { path: "health", method: RequestMethod.GET },
        { path: "health/details", method: RequestMethod.GET },
      )
      .forRoutes({ path: "*", method: RequestMethod.ALL });
  }
}
