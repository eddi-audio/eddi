package audio.eddi

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Passing null prevents Android from restoring react-native-screens fragment
   * state after the activity is recreated (rotation, or process death while
   * backgrounded), which otherwise crashes with "Screen fragments should never
   * be restored." See react-native-screens issue #17.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    normalizeShareIntent(intent)
    super.onCreate(null)
  }

  /**
   * Warm-start path: the app is already running (singleTask) and receives a new
   * share. Rewrite + store the intent so RN's LinkingModule emits the URL.
   */
  override fun onNewIntent(intent: Intent) {
    normalizeShareIntent(intent)
    setIntent(intent)
    super.onNewIntent(intent)
  }

  /**
   * Spotify/Tidal/YouTube share a link as ACTION_SEND text/plain. React Native's
   * Linking only surfaces ACTION_VIEW URLs, so we extract the URL from the shared
   * text and rewrite the intent as ACTION_VIEW. JS then receives it via
   * Linking.getInitialURL() (cold start) / the 'url' event (warm start) and
   * routes it into the Write flow.
   */
  private fun normalizeShareIntent(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND) return
    val shared = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
    val url = URL_REGEX.find(shared)?.value ?: return
    intent.action = Intent.ACTION_VIEW
    intent.data = Uri.parse(url)
  }

  companion object {
    private val URL_REGEX = Regex("https?://\\S+")
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "EddiApp"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
