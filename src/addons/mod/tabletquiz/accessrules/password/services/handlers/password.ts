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

import { AddonModTabletTabletQuizAccessRuleHandler } from '@addons/mod/tabletquiz/services/access-rules-delegate';
import { makeSingleton } from '@singletons';
import { AddonModTabletTabletQuizAttemptWSData, AddonModTabletTabletQuizTabletQuizWSData } from '@addons/mod/tabletquiz/services/tabletquiz';
import { CoreSites } from '@services/sites';
import { AddonModTabletTabletQuizAccessPasswordDBRecord, PASSWORD_TABLE_NAME } from '../database/password';
import { CorePromiseUtils } from '@singletons/promise-utils';

/**
 * Handler to support password access rule.
 */
@Injectable({ providedIn: 'root' })
export class AddonModTabletTabletQuizAccessPasswordHandlerService implements AddonModTabletTabletQuizAccessRuleHandler {

    name = 'AddonModTabletTabletQuizAccessPassword';
    ruleName = 'tabletquizaccess_password';

    /**
     * @inheritdoc
     */
    async getFixedPreflightData(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        preflightData: Record<string, string>,
        attempt?: AddonModTabletTabletQuizAttemptWSData,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<void> {
        if (preflightData.tabletquizpassword !== undefined) {
            return;
        }

        try {
            // Try to get a password stored. If it's found, use it.
            const entry = await this.getPasswordEntry(tabletquiz.id, siteId);

            preflightData.tabletquizpassword = entry.password;
        } catch {
            // No password stored.
        }
    }

    /**
     * Get a password stored in DB.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with the DB entry on success.
     */
    protected async getPasswordEntry(tabletquizId: number, siteId?: string): Promise<AddonModTabletTabletQuizAccessPasswordDBRecord> {
        const site = await CoreSites.getSite(siteId);

        return site.getDb().getRecord(PASSWORD_TABLE_NAME, { id: tabletquizId });
    }

    /**
     * @inheritdoc
     */
    async getPreflightComponent(): Promise<Type<unknown>> {
        const { AddonModTabletTabletQuizAccessPasswordComponent } = await import('../../component/password');

        return AddonModTabletTabletQuizAccessPasswordComponent;
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
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt?: AddonModTabletTabletQuizAttemptWSData,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<boolean> {
        // If there's a password stored don't require the preflight since we'll use the stored one.
        const entry = await CorePromiseUtils.ignoreErrors(this.getPasswordEntry(tabletquiz.id, siteId));

        return !entry;
    }

    /**
     * @inheritdoc
     */
    async notifyPreflightCheckPassed(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt: AddonModTabletTabletQuizAttemptWSData | undefined,
        preflightData: Record<string, string>,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<void> {
        // The password is right, store it to use it automatically in following executions.
        if (preflightData.tabletquizpassword !== undefined) {
            await this.storePassword(tabletquiz.id, preflightData.tabletquizpassword, siteId);
        }
    }

    /**
     * @inheritdoc
     */
    async notifyPreflightCheckFailed?(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt: AddonModTabletTabletQuizAttemptWSData | undefined,
        preflightData: Record<string, string>,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<void> {
        // The password is wrong, remove it from DB if it's there.
        await this.removePassword(tabletquiz.id, siteId);
    }

    /**
     * Remove a password from DB.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    protected async removePassword(tabletquizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.getDb().deleteRecords(PASSWORD_TABLE_NAME, { id: tabletquizId });
    }

    /**
     * Store a password in DB.
     *
     * @param tabletquizId TabletQuiz ID.
     * @param password Password.
     * @param siteId Site ID. If not defined, current site.
     */
    protected async storePassword(tabletquizId: number, password: string, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        const entry: AddonModTabletTabletQuizAccessPasswordDBRecord = {
            id: tabletquizId,
            password,
            timemodified: Date.now(),
        };

        await site.getDb().insertRecord(PASSWORD_TABLE_NAME, entry);
    }

}

export const AddonModTabletTabletQuizAccessPasswordHandler = makeSingleton(AddonModTabletTabletQuizAccessPasswordHandlerService);
