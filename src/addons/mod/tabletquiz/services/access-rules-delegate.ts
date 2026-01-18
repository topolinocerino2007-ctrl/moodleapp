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

import { CoreDelegate, CoreDelegateHandler } from '@classes/delegate';
import { CorePromiseUtils } from '@singletons/promise-utils';
import { makeSingleton } from '@singletons';
import { AddonModTabletTabletQuizAttemptWSData, AddonModTabletTabletQuizTabletQuizWSData } from './tabletquiz';
import { CoreSites } from '@services/sites';
import { ADDON_MOD_TABLETQUIZ_FEATURE_NAME } from '../constants';

/**
 * Interface that all access rules handlers must implement.
 */
export interface AddonModTabletTabletQuizAccessRuleHandler extends CoreDelegateHandler {

    /**
     * Name of the rule the handler supports. E.g. 'password'.
     */
    ruleName: string;

    /**
     * Whether the rule requires a preflight check when prefetch/start/continue an attempt.
     *
     * @param tabletquiz The tabletquiz the rule belongs to.
     * @param attempt The attempt started/continued. If not supplied, user is starting a new attempt.
     * @param prefetch Whether the user is prefetching the tabletquiz.
     * @param siteId Site ID. If not defined, current site.
     * @returns Whether the rule requires a preflight check.
     */
    isPreflightCheckRequired(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt?: AddonModTabletTabletQuizAttemptWSData,
        prefetch?: boolean,
        siteId?: string,
    ): boolean | Promise<boolean>;

    /**
     * Add preflight data that doesn't require user interaction. The data should be added to the preflightData param.
     *
     * @param tabletquiz The tabletquiz the rule belongs to.
     * @param preflightData Object where to add the preflight data.
     * @param attempt The attempt started/continued. If not supplied, user is starting a new attempt.
     * @param prefetch Whether the user is prefetching the tabletquiz.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when done if async, void if it's synchronous.
     */
    getFixedPreflightData?(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        preflightData: Record<string, string>,
        attempt?: AddonModTabletTabletQuizAttemptWSData,
        prefetch?: boolean,
        siteId?: string,
    ): void | Promise<void>;

    /**
     * Return the Component to use to display the access rule preflight.
     * Implement this if your access rule requires a preflight check with user interaction.
     * It's recommended to return the class of the component, but you can also return an instance of the component.
     *
     * @returns The component (or promise resolved with component) to use, undefined if not found.
     */
    getPreflightComponent?(): undefined | Type<unknown> | Promise<undefined | Type<unknown>>;

    /**
     * Function called when the preflight check has passed. This is a chance to record that fact in some way.
     *
     * @param tabletquiz The tabletquiz the rule belongs to.
     * @param attempt The attempt started/continued.
     * @param preflightData Preflight data gathered.
     * @param prefetch Whether the user is prefetching the tabletquiz.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when done if async, void if it's synchronous.
     */
    notifyPreflightCheckPassed?(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt: AddonModTabletTabletQuizAttemptWSData | undefined,
        preflightData: Record<string, string>,
        prefetch?: boolean,
        siteId?: string,
    ): void | Promise<void>;

    /**
     * Function called when the preflight check fails. This is a chance to record that fact in some way.
     *
     * @param tabletquiz The tabletquiz the rule belongs to.
     * @param attempt The attempt started/continued.
     * @param preflightData Preflight data gathered.
     * @param prefetch Whether the user is prefetching the tabletquiz.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when done if async, void if it's synchronous.
     */
    notifyPreflightCheckFailed?(
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt: AddonModTabletTabletQuizAttemptWSData | undefined,
        preflightData: Record<string, string>,
        prefetch?: boolean,
        siteId?: string,
    ): void | Promise<void>;

    /**
     * Whether or not the time left of an attempt should be displayed.
     *
     * @param attempt The attempt.
     * @param endTime The attempt end time (in seconds).
     * @param timeNow The current time in seconds.
     * @returns Whether it should be displayed.
     */
    shouldShowTimeLeft?(attempt: AddonModTabletTabletQuizAttemptWSData, endTime: number, timeNow: number): boolean;
}

/**
 * Delegate to register access rules for tabletquiz module.
 */
@Injectable({ providedIn: 'root' })
export class AddonModTabletTabletQuizAccessRuleDelegateService extends CoreDelegate<AddonModTabletTabletQuizAccessRuleHandler> {

    protected handlerNameProperty = 'ruleName';

    /**
     * @inheritdoc
     */
    async isEnabled(): Promise<boolean> {
        return !(await CoreSites.isFeatureDisabled(ADDON_MOD_TABLETQUIZ_FEATURE_NAME));
    }

    /**
     * Get the handler for a certain rule.
     *
     * @param ruleName Name of the access rule.
     * @returns Handler. Undefined if no handler found for the rule.
     */
    getAccessRuleHandler(ruleName: string): AddonModTabletTabletQuizAccessRuleHandler {
        return this.getHandler(ruleName, true);
    }

    /**
     * Given a list of rules, get some fixed preflight data (data that doesn't require user interaction).
     *
     * @param rules List of active rules names.
     * @param tabletquiz TabletQuiz.
     * @param preflightData Object where to store the preflight data.
     * @param attempt The attempt started/continued. If not supplied, user is starting a new attempt.
     * @param prefetch Whether the user is prefetching the tabletquiz.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved when all the data has been gathered.
     */
    async getFixedPreflightData(
        rules: string[],
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        preflightData: Record<string, string>,
        attempt?: AddonModTabletTabletQuizAttemptWSData,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<void> {
        rules = rules || [];

        await CorePromiseUtils.allPromisesIgnoringErrors(rules.map(async (rule) => {
            await this.executeFunctionOnEnabled(rule, 'getFixedPreflightData', [tabletquiz, preflightData, attempt, prefetch, siteId]);
        }));
    }

    /**
     * Get the Component to use to display the access rule preflight.
     *
     * @param rule Rule.
     * @returns Promise resolved with the component to use, undefined if not found.
     */
    getPreflightComponent(rule: string): Promise<Type<unknown> | undefined> {
        return Promise.resolve(this.executeFunctionOnEnabled(rule, 'getPreflightComponent', []));
    }

    /**
     * Check if an access rule is supported.
     *
     * @param ruleName Name of the rule.
     * @returns Whether it's supported.
     */
    isAccessRuleSupported(ruleName: string): boolean {
        return this.hasHandler(ruleName, true);
    }

    /**
     * Given a list of rules, check if preflight check is required.
     *
     * @param rules List of active rules names.
     * @param tabletquiz TabletQuiz.
     * @param attempt The attempt started/continued. If not supplied, user is starting a new attempt.
     * @param prefetch Whether the user is prefetching the tabletquiz.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with boolean: whether it's required.
     */
    async isPreflightCheckRequired(
        rules: string[],
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt?: AddonModTabletTabletQuizAttemptWSData,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<boolean> {
        rules = rules || [];
        let isRequired = false;

        await CorePromiseUtils.allPromisesIgnoringErrors(rules.map(async (rule) => {
            const ruleRequired = await this.isPreflightCheckRequiredForRule(rule, tabletquiz, attempt, prefetch, siteId);

            isRequired = isRequired || ruleRequired;
        }));

        return isRequired;
    }

    /**
     * Check if preflight check is required for a certain rule.
     *
     * @param rule Rule name.
     * @param tabletquiz TabletQuiz.
     * @param attempt The attempt started/continued. If not supplied, user is starting a new attempt.
     * @param prefetch Whether the user is prefetching the tabletquiz.
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with boolean: whether it's required.
     */
    async isPreflightCheckRequiredForRule(
        rule: string,
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt?: AddonModTabletTabletQuizAttemptWSData,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<boolean> {
        const isRequired = await this.executeFunctionOnEnabled(rule, 'isPreflightCheckRequired', [tabletquiz, attempt, prefetch, siteId]);

        return !!isRequired;
    }

    /**
     * Notify all rules that the preflight check has passed.
     *
     * @param rules List of active rules names.
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @param preflightData Preflight data gathered.
     * @param prefetch Whether the user is prefetching the tabletquiz.
     * @param siteId Site ID. If not defined, current site.
     */
    async notifyPreflightCheckPassed(
        rules: string[],
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt: AddonModTabletTabletQuizAttemptWSData | undefined,
        preflightData: Record<string, string>,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<void> {
        rules = rules || [];

        await CorePromiseUtils.allPromisesIgnoringErrors(rules.map(async (rule) => {
            await this.executeFunctionOnEnabled(
                rule,
                'notifyPreflightCheckPassed',
                [tabletquiz, attempt, preflightData, prefetch, siteId],
            );
        }));
    }

    /**
     * Notify all rules that the preflight check has failed.
     *
     * @param rules List of active rules names.
     * @param tabletquiz TabletQuiz.
     * @param attempt Attempt.
     * @param preflightData Preflight data gathered.
     * @param prefetch Whether the user is prefetching the tabletquiz.
     * @param siteId Site ID. If not defined, current site.
     */
    async notifyPreflightCheckFailed(
        rules: string[],
        tabletquiz: AddonModTabletTabletQuizTabletQuizWSData,
        attempt: AddonModTabletTabletQuizAttemptWSData | undefined,
        preflightData: Record<string, string>,
        prefetch?: boolean,
        siteId?: string,
    ): Promise<void> {
        rules = rules || [];

        await CorePromiseUtils.allPromisesIgnoringErrors(rules.map(async (rule) => {
            await this.executeFunctionOnEnabled(
                rule,
                'notifyPreflightCheckFailed',
                [tabletquiz, attempt, preflightData, prefetch, siteId],
            );
        }));
    }

    /**
     * Whether or not the time left of an attempt should be displayed.
     *
     * @param rules List of active rules names.
     * @param attempt The attempt.
     * @param endTime The attempt end time (in seconds).
     * @param timeNow The current time in seconds.
     * @returns Whether it should be displayed.
     */
    shouldShowTimeLeft(rules: string[], attempt: AddonModTabletTabletQuizAttemptWSData, endTime: number, timeNow: number): boolean {
        rules = rules || [];

        for (const i in rules) {
            const rule = rules[i];

            if (this.executeFunctionOnEnabled(rule, 'shouldShowTimeLeft', [attempt, endTime, timeNow])) {
                return true;
            }
        }

        return false;
    }

}

export const AddonModTabletTabletQuizAccessRuleDelegate = makeSingleton(AddonModTabletTabletQuizAccessRuleDelegateService);
