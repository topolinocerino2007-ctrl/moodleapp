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

import { Injectable, Type } from '@angular/core';

import { AddonModTabletQuizAccessRuleHandler } from '@addons/mod/tabletquiz/services/access-rules-delegate';
import { AddonModTabletQuizAttemptWSData, AddonModTabletQuizTabletQuizWSData } from '@addons/mod/tabletquiz/services/tabletquiz';
import { AddonModTabletQuizSync } from '@addons/mod/tabletquiz/services/tabletquiz-sync';
import { makeSingleton } from '@singletons';

/**
 * Handler to support offline attempts access rule.
 */
@Injectable({ providedIn: 'root' })
export class AddonModTabletQuizAccessOfflineAttemptsHandlerService implements AddonModTabletQuizAccessRuleHandler {

    name = 'AddonModTabletQuizAccessOfflineAttempts';
    ruleName = 'tabletquizaccess_offlineattempts';

    /**
     * @inheritdoc
     */
    getFixedPreflightData(
        tabletquiz: AddonModTabletQuizTabletQuizWSData,
        preflightData: Record<string, string>,
    ): void | Promise<void> {
        preflightData.confirmdatasaved = '1';
    }

    /**
     * @inheritdoc
     */
    async getPreflightComponent(): Promise<Type<unknown>> {
        const { AddonModTabletQuizAccessOfflineAttemptsComponent } = await import('../../component/offlineattempts');

        return AddonModTabletQuizAccessOfflineAttemptsComponent;
    }

    /**
     * @inheritdoc
     */
    async isEnabled(): Promise<boolean> {
        return true;
    }

    /**
     * @inheritdoc
     */
    async isPreflightCheckRequired(
        tabletquiz: AddonModTabletQuizTabletQuizWSData,
        attempt?: AddonModTabletQuizAttemptWSData,
        prefetch?: boolean,
    ): Promise<boolean> {
        if (prefetch) {
            // Don't show the warning if the user is prefetching.
            return false;
        }

        if (!attempt) {
            // User is starting a new attempt, show the warning.
            return true;
        }

        const syncTime = await AddonModTabletQuizSync.getSyncTime(tabletquiz.id);

        // Show warning if last sync was a while ago.
        return Date.now() - AddonModTabletQuizSync.syncInterval > syncTime;
    }

}

export const AddonModTabletQuizAccessOfflineAttemptsHandler = makeSingleton(AddonModTabletQuizAccessOfflineAttemptsHandlerService);
