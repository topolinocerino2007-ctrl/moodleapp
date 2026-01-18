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
import { makeSingleton } from '@singletons';
import { AddonModTabletQuizAttemptWSData, AddonModTabletQuizQuizWSData } from '@addons/mod/tabletquiz/services/quiz';
import { CoreSites } from '@services/sites';
import { AddonModTabletQuizAccessPasswordDBRecord, PASSWORD_TABLE_NAME } from '../database/password';
import { CorePromiseUtils } from '@singletons/promise-utils';

/**
 * Handler to support password access rule.
 */
@Injectable({ providedIn: 'root' })
export class AddonModTabletQuizAccessPasswordHandlerService implements AddonModTabletQuizAccessRuleHandler {

    name = 'AddonModTabletQuizAccessPassword';
    ruleName = 'quizaccess_password';

    /**
     * @inheritdoc
     */
    async getFixedPreflightData(
        quiz: AddonModTabletQuizQuizWSData,
        preflightData: Record<string, string>,
        attempt?: AddonModTabletQuizAttemptWSData,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<void> {
        if (preflightData.quizpassword !== undefined) {
            return;
        }

        try {
            // Try to get a password stored. If it's found, use it.
            const entry = await this.getPasswordEntry(quiz.id, siteId);

            preflightData.quizpassword = entry.password;
        } catch {
            // No password stored.
        }
    }

    /**
     * Get a password stored in DB.
     *
     * @param quizId Quiz ID.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with the DB entry on success.
     */
    protected async getPasswordEntry(quizId: number, siteId?: string): Promise<AddonModTabletQuizAccessPasswordDBRecord> {
        const site = await CoreSites.getSite(siteId);

        return site.getDb().getRecord(PASSWORD_TABLE_NAME, { id: quizId });
    }

    /**
     * @inheritdoc
     */
    async getPreflightComponent(): Promise<Type<unknown>> {
        const { AddonModTabletQuizAccessPasswordComponent } = await import('../../component/password');

        return AddonModTabletQuizAccessPasswordComponent;
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
        quiz: AddonModTabletQuizQuizWSData,
        attempt?: AddonModTabletQuizAttemptWSData,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<boolean> {
        // If there's a password stored don't require the preflight since we'll use the stored one.
        const entry = await CorePromiseUtils.ignoreErrors(this.getPasswordEntry(quiz.id, siteId));

        return !entry;
    }

    /**
     * @inheritdoc
     */
    async notifyPreflightCheckPassed(
        quiz: AddonModTabletQuizQuizWSData,
        attempt: AddonModTabletQuizAttemptWSData | undefined,
        preflightData: Record<string, string>,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<void> {
        // The password is right, store it to use it automatically in following executions.
        if (preflightData.quizpassword !== undefined) {
            await this.storePassword(quiz.id, preflightData.quizpassword, siteId);
        }
    }

    /**
     * @inheritdoc
     */
    async notifyPreflightCheckFailed?(
        quiz: AddonModTabletQuizQuizWSData,
        attempt: AddonModTabletQuizAttemptWSData | undefined,
        preflightData: Record<string, string>,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<void> {
        // The password is wrong, remove it from DB if it's there.
        await this.removePassword(quiz.id, siteId);
    }

    /**
     * Remove a password from DB.
     *
     * @param quizId Quiz ID.
     * @param siteId Site ID. If not defined, current site.
     */
    protected async removePassword(quizId: number, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        await site.getDb().deleteRecords(PASSWORD_TABLE_NAME, { id: quizId });
    }

    /**
     * Store a password in DB.
     *
     * @param quizId Quiz ID.
     * @param password Password.
     * @param siteId Site ID. If not defined, current site.
     */
    protected async storePassword(quizId: number, password: string, siteId?: string): Promise<void> {
        const site = await CoreSites.getSite(siteId);

        const entry: AddonModTabletQuizAccessPasswordDBRecord = {
            id: quizId,
            password,
            timemodified: Date.now(),
        };

        await site.getDb().insertRecord(PASSWORD_TABLE_NAME, entry);
    }

}

export const AddonModTabletQuizAccessPasswordHandler = makeSingleton(AddonModTabletQuizAccessPasswordHandlerService);

