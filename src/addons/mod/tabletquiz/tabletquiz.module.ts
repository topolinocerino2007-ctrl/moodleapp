// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { NgModule, Type, provideAppInitializer } from '@angular/core';
import { Routes } from '@angular/router';
import { CoreContentLinksDelegate } from '@features/contentlinks/services/contentlinks-delegate';
import { CoreCourseHelper } from '@features/course/services/course-helper';

import { CoreCourseModuleDelegate } from '@features/course/services/module-delegate';
import { CoreCourseModulePrefetchDelegate } from '@features/course/services/module-prefetch-delegate';
import { CoreMainMenuTabRoutingModule } from '@features/mainmenu/mainmenu-tab-routing.module';
import { CorePushNotificationsDelegate } from '@features/pushnotifications/services/push-delegate';
import { CoreCronDelegate } from '@services/cron';
import { CORE_SITE_SCHEMAS } from '@services/sites';
import { AddonModTabletTabletQuizAccessRulesModule } from './accessrules/accessrules.module';
import { SITE_SCHEMA } from './services/database/tabletquiz';
import { AddonModTabletTabletQuizGradeLinkHandler } from './services/handlers/grade-link';
import { AddonModTabletTabletQuizIndexLinkHandler } from './services/handlers/index-link';
import { AddonModTabletTabletQuizListLinkHandler } from './services/handlers/list-link';
import { AddonModTabletTabletQuizModuleHandler } from './services/handlers/module';
import { AddonModTabletTabletQuizPrefetchHandler } from './services/handlers/prefetch';
import { AddonModTabletTabletQuizPushClickHandler } from './services/handlers/push-click';
import { AddonModTabletTabletQuizReviewLinkHandler } from './services/handlers/review-link';
import { AddonModTabletTabletQuizSyncCronHandler } from './services/handlers/sync-cron';
import { ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, ADDON_MOD_TABLETQUIZ_PAGE_NAME } from './constants';
import { canLeaveGuard } from '@guards/can-leave';

/**
 * Get mod TabletQuiz services.
 *
 * @returns Returns mod TabletQuiz services.
 */
export async function getModTabletQuizServices(): Promise<Type<unknown>[]> {
    const { AddonModTabletTabletQuizProvider } = await import('@addons/mod/tabletquiz/services/tabletquiz');
    const { AddonModTabletTabletQuizOfflineProvider } = await import('@addons/mod/tabletquiz/services/tabletquiz-offline');
    const { AddonModTabletTabletQuizHelperProvider } = await import('@addons/mod/tabletquiz/services/tabletquiz-helper');
    const { AddonModTabletTabletQuizSyncProvider } = await import('@addons/mod/tabletquiz/services/tabletquiz-sync');
    const { AddonModTabletTabletQuizAccessRuleDelegateService } = await import('@addons/mod/tabletquiz/services/access-rules-delegate');

    return [
        AddonModTabletTabletQuizAccessRuleDelegateService,
        AddonModTabletTabletQuizProvider,
        AddonModTabletTabletQuizOfflineProvider,
        AddonModTabletTabletQuizHelperProvider,
        AddonModTabletTabletQuizSyncProvider,
    ];
}

const routes: Routes = [
    {
        path: ADDON_MOD_TABLETQUIZ_PAGE_NAME,
        loadChildren: () => [
            {
                path: ':courseId/:cmId',
                loadComponent: () => import('./pages/index/index'),
            },
            {
                path: ':courseId/:cmId/player',
                loadComponent: () => import('./pages/player/player'),
                canDeactivate: [canLeaveGuard],
            },
            {
                path: ':courseId/:cmId/review/:attemptId',
                loadComponent: () => import('./pages/review/review'),
            },
        ],
    },
];

@NgModule({
    imports: [
        CoreMainMenuTabRoutingModule.forChild(routes),
        AddonModTabletTabletQuizAccessRulesModule,
    ],
    providers: [
        {
            provide: CORE_SITE_SCHEMAS,
            useValue: [SITE_SCHEMA],
            multi: true,
        },
        provideAppInitializer(() => {
            CoreCourseModuleDelegate.registerHandler(AddonModTabletTabletQuizModuleHandler.instance);
            CoreCourseModulePrefetchDelegate.registerHandler(AddonModTabletTabletQuizPrefetchHandler.instance);
            CoreContentLinksDelegate.registerHandler(AddonModTabletTabletQuizGradeLinkHandler.instance);
            CoreContentLinksDelegate.registerHandler(AddonModTabletTabletQuizIndexLinkHandler.instance);
            CoreContentLinksDelegate.registerHandler(AddonModTabletTabletQuizListLinkHandler.instance);
            CoreContentLinksDelegate.registerHandler(AddonModTabletTabletQuizReviewLinkHandler.instance);
            CorePushNotificationsDelegate.registerClickHandler(AddonModTabletTabletQuizPushClickHandler.instance);
            CoreCronDelegate.register(AddonModTabletTabletQuizSyncCronHandler.instance);

            CoreCourseHelper.registerModuleReminderClick(ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY);
        }),
    ],
})
export class AddonModTabletTabletQuizModule {}
