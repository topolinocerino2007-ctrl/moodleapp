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
import { AddonModTabletQuizAccessRulesModule } from './accessrules/accessrules.module';
import { SITE_SCHEMA } from './services/database/tabletquiz';
import { AddonModTabletQuizGradeLinkHandler } from './services/handlers/grade-link';
import { AddonModTabletQuizIndexLinkHandler } from './services/handlers/index-link';
import { AddonModTabletQuizListLinkHandler } from './services/handlers/list-link';
import { AddonModTabletQuizModuleHandler } from './services/handlers/module';
import { AddonModTabletQuizPrefetchHandler } from './services/handlers/prefetch';
import { AddonModTabletQuizPushClickHandler } from './services/handlers/push-click';
import { AddonModTabletQuizReviewLinkHandler } from './services/handlers/review-link';
import { AddonModTabletQuizSyncCronHandler } from './services/handlers/sync-cron';
import { ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY, ADDON_MOD_TABLETQUIZ_PAGE_NAME } from './constants';
import { canLeaveGuard } from '@guards/can-leave';

/**
 * Get mod TabletQuiz services.
 *
 * @returns Returns mod TabletQuiz services.
 */
export async function getModTabletQuizServices(): Promise<Type<unknown>[]> {
    const { AddonModTabletQuizProvider } = await import('@addons/mod/tabletquiz/services/tabletquiz');
    const { AddonModTabletQuizOfflineProvider } = await import('@addons/mod/tabletquiz/services/tabletquiz-offline');
    const { AddonModTabletQuizHelperProvider } = await import('@addons/mod/tabletquiz/services/tabletquiz-helper');
    const { AddonModTabletQuizSyncProvider } = await import('@addons/mod/tabletquiz/services/tabletquiz-sync');
    const { AddonModTabletQuizAccessRuleDelegateService } = await import('@addons/mod/tabletquiz/services/access-rules-delegate');

    return [
        AddonModTabletQuizAccessRuleDelegateService,
        AddonModTabletQuizProvider,
        AddonModTabletQuizOfflineProvider,
        AddonModTabletQuizHelperProvider,
        AddonModTabletQuizSyncProvider,
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
        AddonModTabletQuizAccessRulesModule,
    ],
    providers: [
        {
            provide: CORE_SITE_SCHEMAS,
            useValue: [SITE_SCHEMA],
            multi: true,
        },
        provideAppInitializer(() => {
            CoreCourseModuleDelegate.registerHandler(AddonModTabletQuizModuleHandler.instance);
            CoreCourseModulePrefetchDelegate.registerHandler(AddonModTabletQuizPrefetchHandler.instance);
            CoreContentLinksDelegate.registerHandler(AddonModTabletQuizGradeLinkHandler.instance);
            CoreContentLinksDelegate.registerHandler(AddonModTabletQuizIndexLinkHandler.instance);
            CoreContentLinksDelegate.registerHandler(AddonModTabletQuizListLinkHandler.instance);
            CoreContentLinksDelegate.registerHandler(AddonModTabletQuizReviewLinkHandler.instance);
            CorePushNotificationsDelegate.registerClickHandler(AddonModTabletQuizPushClickHandler.instance);
            CoreCronDelegate.register(AddonModTabletQuizSyncCronHandler.instance);

            CoreCourseHelper.registerModuleReminderClick(ADDON_MOD_TABLETQUIZ_COMPONENT_LEGACY);
        }),
    ],
})
export class AddonModTabletQuizModule {}
