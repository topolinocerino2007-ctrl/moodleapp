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

import { AddonModTabletTabletQuizAccessDelayBetweenAttemptsModule } from './delaybetweenattempts/delaybetweenattempts.module';
import { AddonModTabletTabletQuizAccessIpAddressModule } from './ipaddress/ipaddress.module';
import { AddonModTabletTabletQuizAccessNumAttemptsModule } from './numattempts/numattempts.module';
import { AddonModTabletTabletQuizAccessOfflineAttemptsModule } from './offlineattempts/offlineattempts.module';
import { AddonModTabletTabletQuizAccessOpenCloseDateModule } from './openclosedate/openclosedate.module';
import { AddonModTabletTabletQuizAccessPasswordModule } from './password/password.module';
import { AddonModTabletTabletQuizAccessSafeBrowserModule } from './safebrowser/safebrowser.module';
import { AddonModTabletTabletQuizAccessSecureWindowModule } from './securewindow/securewindow.module';
import { AddonModTabletTabletQuizAccessTimeLimitModule } from './timelimit/timelimit.module';

@NgModule({
    imports: [
        AddonModTabletTabletQuizAccessDelayBetweenAttemptsModule,
        AddonModTabletTabletQuizAccessIpAddressModule,
        AddonModTabletTabletQuizAccessNumAttemptsModule,
        AddonModTabletTabletQuizAccessOfflineAttemptsModule,
        AddonModTabletTabletQuizAccessOpenCloseDateModule,
        AddonModTabletTabletQuizAccessPasswordModule,
        AddonModTabletTabletQuizAccessSafeBrowserModule,
        AddonModTabletTabletQuizAccessSecureWindowModule,
        AddonModTabletTabletQuizAccessTimeLimitModule,
    ],
})
export class AddonModTabletTabletQuizAccessRulesModule {}
