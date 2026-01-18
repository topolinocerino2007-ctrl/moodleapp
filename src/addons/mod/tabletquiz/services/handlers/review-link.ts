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
import { CoreContentLinksHandlerBase } from '@features/contentlinks/classes/base-handler';
import { CoreContentLinksAction } from '@features/contentlinks/services/contentlinks-delegate';
import { makeSingleton } from '@singletons';
import { AddonModTabletTabletQuizHelper } from '../tabletquiz-helper';
import { ADDON_MOD_TABLETQUIZ_FEATURE_NAME } from '../../constants';

/**
 * Handler to treat links to tabletquiz review.
 */
@Injectable({ providedIn: 'root' })
export class AddonModTabletTabletQuizReviewLinkHandlerService extends CoreContentLinksHandlerBase {

    name = 'AddonModTabletTabletQuizReviewLinkHandler';
    featureName = ADDON_MOD_TABLETQUIZ_FEATURE_NAME;
    pattern = /\/mod\/tabletquiz\/review\.php.*([&?]attempt=\d+)/;

    /**
     * Get the list of actions for a link (url).
     *
     * @param siteIds List of sites the URL belongs to.
     * @param url The URL to treat.
     * @param params The params of the URL. E.g. 'mysite.com?id=1' -> {id: 1}
     * @param courseId Course ID related to the URL. Optional but recommended.
     * @param data Extra data to handle the URL.
     * @returns List of (or promise resolved with list of) actions.
     */

    getActions(
        siteIds: string[],
        url: string,
        params: Record<string, string>,
        courseId?: number,
        data?: Record<string, unknown>,
    ): CoreContentLinksAction[] | Promise<CoreContentLinksAction[]> {
        const tabletquizId = data?.instance ? Number(data.instance) : undefined;

        return [{
            action: async (siteId): Promise<void> => {
                const attemptId = parseInt(params.attempt, 10);
                const page = parseInt(params.page, 10);
                await AddonModTabletTabletQuizHelper.handleReviewLink(attemptId, page, tabletquizId, siteId);
            },
        }];
    }

}

export const AddonModTabletTabletQuizReviewLinkHandler = makeSingleton(AddonModTabletTabletQuizReviewLinkHandlerService);
