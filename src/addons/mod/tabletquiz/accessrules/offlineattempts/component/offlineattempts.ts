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

import { toBoolean } from '@/core/transforms/boolean';
import { AddonModTabletTabletQuizAttemptWSData, AddonModTabletTabletQuizTabletQuizWSData } from '@addons/mod/tabletquiz/services/tabletquiz';
import { AddonModTabletTabletQuizSync } from '@addons/mod/tabletquiz/services/tabletquiz-sync';
import { Component, OnInit, Input, inject } from '@angular/core';
import { FormGroup, FormBuilder } from '@angular/forms';
import { CoreSharedModule } from '@/core/shared.module';

/**
 * Component to render the preflight for offline attempts.
 */
@Component({
    selector: 'addon-mod-tablettabletquiz-access-offline-attempts',
    templateUrl: 'addon-mod-tablettabletquiz-access-offline-attempts.html',
    imports: [
        CoreSharedModule,
    ],
})
export class AddonModTabletTabletQuizAccessOfflineAttemptsComponent implements OnInit {

    @Input() rule?: string; // The name of the rule.
    @Input() tabletquiz?: AddonModTabletTabletQuizTabletQuizWSData; // The tabletquiz the rule belongs to.
    @Input() attempt?: AddonModTabletTabletQuizAttemptWSData; // The attempt being started/continued.
    @Input({ transform: toBoolean }) prefetch = false; // Whether the user is prefetching the tabletquiz.
    @Input() siteId?: string; // Site ID.
    @Input() form?: FormGroup; // Form where to add the form control.

    syncTimeReadable = '';

    private fb = inject(FormBuilder);

    /**
     * @inheritdoc
     */
    async ngOnInit(): Promise<void> {
        // Always set confirmdatasaved to 1. Sending the data means the user accepted.
        this.form?.addControl('confirmdatasaved', this.fb.control(1));

        if (!this.tabletquiz) {
            return;
        }

        const time = await AddonModTabletTabletQuizSync.getSyncTime(this.tabletquiz.id);

        this.syncTimeReadable = AddonModTabletTabletQuizSync.getReadableTimeFromTimestamp(time);
    }

}
