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

import { Injectable } from '@angular/core';

import { CoreCourseHelper } from '@features/course/services/course-helper';
import { CorePushNotificationsClickHandler } from '@features/pushnotifications/services/push-delegate';
import { CorePushNotificationsNotificationBasicData } from '@features/pushnotifications/services/pushnotifications';
import { CoreUrl } from '@singletons/url';
import { CoreUtils } from '@singletons/utils';
import { makeSingleton } from '@singletons';
import { AddonModTabletQuiz } from '../tabletquiz';
import { AddonModTabletQuizHelper } from '../tabletquiz-helper';
import { isSafeNumber } from '@/core/utils/types';
import { ADDON_MOD_TABLETQUIZ_FEATURE_NAME } from '../../constants';
import { CorePromiseUtils } from '@singletons/promise-utils';

/**
 * Handler for TabletQuiz push notifications clicks.
 */
@Injectable({ providedIn: 'root' })
export class AddonModTabletQuizPushClickHandlerService implements CorePushNotificationsClickHandler {

    name = 'AddonModTabletQuizPushClickHandler';
    priority = 200;
    featureName = ADDON_MOD_TABLETQUIZ_FEATURE_NAME;

    protected static readonly SUPPORTED_NAMES = ['submission', 'confirmation', 'attempt_overdue'];

    /**
     * @inheritdoc
     */
    async handles(notification: AddonModTabletQuizPushNotificationData): Promise<boolean> {
        return CoreUtils.isTrueOrOne(notification.notif) && notification.moodlecomponent == 'mod_tabletquiz' &&
                AddonModTabletQuizPushClickHandlerService.SUPPORTED_NAMES.indexOf(notification.name ?? '') !== -1 &&
                !!(notification.customdata?.instance || notification.contexturl);
    }

    /**
     * @inheritdoc
     */
    async handleClick(notification: AddonModTabletQuizPushNotificationData): Promise<void> {
        const contextUrlParams = CoreUrl.extractUrlParams(notification.contexturl || '');
        const data = notification.customdata || {};
        const courseId = Number(notification.courseid);

        if (
            notification.name === 'submission' &&
            data.instance !== undefined &&
            contextUrlParams.attempt !== undefined &&
            contextUrlParams.page !== undefined
        ) {
            // A student made a submission, go to view the attempt.
            await AddonModTabletQuizHelper.handleReviewLink(
                Number(contextUrlParams.attempt),
                Number(contextUrlParams.page),
                Number(data.instance),
                notification.site,
            );

            return;
        }

        // Open the activity.
        const moduleId = Number(contextUrlParams.id);
        if (!isSafeNumber(moduleId)) {
            return;
        }

        await CorePromiseUtils.ignoreErrors(AddonModTabletQuiz.invalidateContent(moduleId, courseId, notification.site));

        await CoreCourseHelper.navigateToModule(moduleId, {
            courseId,
            siteId: notification.site,
        });
    }

}

export const AddonModTabletQuizPushClickHandler = makeSingleton(AddonModTabletQuizPushClickHandlerService);

type AddonModTabletQuizPushNotificationData = CorePushNotificationsNotificationBasicData & {
    contexturl?: string;
    courseid?: number | string;
};

