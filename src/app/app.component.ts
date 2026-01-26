// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { AfterViewInit, Component, OnInit, viewChild } from '@angular/core';
import { IonRouterOutlet, IonicModule } from '@ionic/angular';
import { BackButtonEvent } from '@ionic/core';

import { CoreLoginHelper } from '@features/login/services/login-helper';
import { SplashScreen } from '@singletons';
import { CoreApp } from '@services/app';
import { CoreNavigator } from '@services/navigator';
import { CoreSubscriptions } from '@singletons/subscriptions';
import { CoreWindow } from '@singletons/window';
import { CorePlatform } from '@services/platform';
import { CoreLogger } from '@singletons/logger';
import { CorePromisedValue } from '@classes/promised-value';
import { register } from 'swiper/element/bundle';
import { CoreWait } from '@singletons/wait';
import { CoreOpener } from '@singletons/opener';
import { BackButtonPriority } from '@/core/constants';

register();

@Component({
    selector: 'app-root',
    templateUrl: 'app.component.html',
    imports: [IonicModule],
})
export class AppComponent implements OnInit, AfterViewInit {

    readonly outlet = viewChild.required(IonRouterOutlet);

    protected logger = CoreLogger.getInstance('AppComponent');

    /**
     * @inheritdoc
     */
    ngOnInit(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = <any> window;

        CorePlatform.resume.subscribe(() => {
            // Wait a second before setting it to false since in iOS there could be some frozen WS calls.
            setTimeout(() => {
                if (CoreLoginHelper.isWaitingForBrowser() && !CoreOpener.isInAppBrowserOpen()) {
                    CoreLoginHelper.stopWaitingForBrowser();
                    CoreLoginHelper.checkLogout();
                }
            }, 1000);
        });

        // "Expose" CoreWindow.open.
        win.openWindowSafely = (url: string, name?: string): void => {
            CoreWindow.open(url, name);
        };

        // Treat URLs that try to override the app.
        win.onOverrideUrlLoading = (url: string) => {
            CoreWindow.open(url);
        };

        // Quit app with back button.
        document.addEventListener('ionBackButton', (event: BackButtonEvent) => {
            event.detail.register(BackButtonPriority.QUIT_APP, async () => {
                const initialPath = CoreNavigator.getCurrentPath();

                if (initialPath.startsWith('/main/')) {
                    // Main menu has its own callback to handle back.
                    // If this callback is called it means we should exit app.
                    CoreApp.closeApp();
                    return;
                }

                // This callback can be called at the same time as Ionic's back navigation callback.
                // Check if the path changes due to the back navigation handler, to know if we're at root level.
                await CoreWait.wait(50);

                if (CoreNavigator.getCurrentPath() !== initialPath) {
                    // Ionic has navigated back, nothing else to do.
                    return;
                }

                // Quit the app.
                CoreApp.closeApp();
            });
        });

        // Workaround for aria-hidden + focus issue
        const observer = new MutationObserver((mutations) => {
            if (!(document.activeElement instanceof HTMLElement)) {
                return;
            }

            for (const mutation of mutations) {
                if (
                    mutation.target instanceof HTMLElement &&
                    mutation.target.ariaHidden === 'true' &&
                    mutation.target.contains(document.activeElement)
                ) {
                    document.activeElement.blur();
                    return;
                }
            }
        });

        observer.observe(document.body, {
            attributeFilter: ['aria-hidden'],
            subtree: true,
        });

        // @todo Pause Youtube videos in Android when app is put in background or screen is locked?
    }

    /**
     * @inheritdoc
     */
    ngAfterViewInit(): void {
        this.logger.debug('App component initialized');

        CoreSubscriptions.once(this.outlet().activateEvents, async () => {
            await CorePlatform.ready();

            this.logger.debug('Hide splash screen');
            SplashScreen.hide();
            this.setSystemUIColorsAfterSplash();
        });
    }

    /**
     * Set the system UI colors after hiding the splash to ensure it's correct.
     */
    protected async setSystemUIColorsAfterSplash(): Promise<void> {
        // Only needed on Android
        if (!CorePlatform.isAndroid()) {
            CoreApp.setSystemUIColors();
            return;
        }

        const promise = new CorePromisedValue<void>();

        const interval = window.setInterval(() => {
            CoreApp.setSystemUIColors();
        });

        setTimeout(() => {
            clearInterval(interval);
            promise.resolve();
        }, 1000);

        return promise;
    }

}
