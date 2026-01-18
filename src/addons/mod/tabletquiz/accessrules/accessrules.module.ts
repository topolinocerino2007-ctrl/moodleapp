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

import { NgModule } from '@angular/core';

import { AddonModTabletQuizAccessDelayBetweenAttemptsModule } from './delaybetweenattempts/delaybetweenattempts.module';
import { AddonModTabletQuizAccessIpAddressModule } from './ipaddress/ipaddress.module';
import { AddonModTabletQuizAccessNumAttemptsModule } from './numattempts/numattempts.module';
import { AddonModTabletQuizAccessOfflineAttemptsModule } from './offlineattempts/offlineattempts.module';
import { AddonModTabletQuizAccessOpenCloseDateModule } from './openclosedate/openclosedate.module';
import { AddonModTabletQuizAccessPasswordModule } from './password/password.module';
import { AddonModTabletQuizAccessSafeBrowserModule } from './safebrowser/safebrowser.module';
import { AddonModTabletQuizAccessSecureWindowModule } from './securewindow/securewindow.module';
import { AddonModTabletQuizAccessTimeLimitModule } from './timelimit/timelimit.module';

@NgModule({
    imports: [
        AddonModTabletQuizAccessDelayBetweenAttemptsModule,
        AddonModTabletQuizAccessIpAddressModule,
        AddonModTabletQuizAccessNumAttemptsModule,
        AddonModTabletQuizAccessOfflineAttemptsModule,
        AddonModTabletQuizAccessOpenCloseDateModule,
        AddonModTabletQuizAccessPasswordModule,
        AddonModTabletQuizAccessSafeBrowserModule,
        AddonModTabletQuizAccessSecureWindowModule,
        AddonModTabletQuizAccessTimeLimitModule,
    ],
})
export class AddonModTabletQuizAccessRulesModule {}
