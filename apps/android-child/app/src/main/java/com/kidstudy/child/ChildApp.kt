package com.kidstudy.child

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Draw
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.HistoryEdu
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.LockOpen
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlin.math.max

private val LightColors = lightColorScheme(
    primary = Color(0xFF006B5F),
    onPrimary = Color.White,
    primaryContainer = Color(0xFF9CF2E2),
    onPrimaryContainer = Color(0xFF00201C),
    secondary = Color(0xFF735B00),
    secondaryContainer = Color(0xFFFFE171),
    tertiary = Color(0xFF9B3F45),
    tertiaryContainer = Color(0xFFFFDADB),
    background = Color(0xFFF7F9FA),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFE7ECEA),
)

@Composable
fun KidStudyChildApp(
    viewModel: ChildViewModel,
    onBiometricParentUnlock: (() -> Unit) -> Unit = {},
) {
    val state by viewModel.state
    MaterialTheme(colorScheme = LightColors) {
        when {
            state.checkingSession -> LoadingScreen()
            !state.loggedIn -> LoginScreen(
                initialEndpoint = state.endpoint,
                busy = state.busyAction == "login",
                error = state.error,
                onLogin = viewModel::login,
            )
            else -> MainShell(state, viewModel, onBiometricParentUnlock)
        }
    }
}

@Composable
private fun LoadingScreen() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator()
    }
}

@Composable
private fun LoginScreen(
    initialEndpoint: String,
    busy: Boolean,
    error: String?,
    onLogin: (String, String) -> Unit,
) {
    var endpoint by rememberSaveable(initialEndpoint) { mutableStateOf(initialEndpoint) }
    var pin by rememberSaveable { mutableStateOf("") }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding(),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp)
                .width(520.dp),
            shape = RoundedCornerShape(8.dp),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Column(
                modifier = Modifier.padding(32.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                Icon(
                    imageVector = Icons.Default.Lock,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(36.dp),
                )
                Text(
                    text = "孩子登录",
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                OutlinedTextField(
                    value = endpoint,
                    onValueChange = { endpoint = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("服务地址") },
                    singleLine = true,
                    enabled = !busy,
                )
                OutlinedTextField(
                    value = pin,
                    onValueChange = { pin = it.filter(Char::isDigit).take(12) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("孩子 PIN") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    enabled = !busy,
                )
                if (error != null) {
                    Text(
                        text = error,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
                Button(
                    onClick = { onLogin(endpoint, pin) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    enabled = pin.isNotBlank() && !busy,
                ) {
                    if (busy) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(22.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("登录")
                    }
                }
            }
        }
    }
}

@Composable
private fun MainShell(
    state: ChildUiState,
    viewModel: ChildViewModel,
    onBiometricParentUnlock: (() -> Unit) -> Unit,
) {
    val snackbar = remember { SnackbarHostState() }
    val message = state.error ?: state.notice
    LaunchedEffect(message) {
        if (message != null) {
            snackbar.showSnackbar(message)
            viewModel.clearMessage()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            Column {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface)
                        .safeDrawingPadding()
                        .padding(horizontal = 20.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = if (
                                state.screen == ChildScreen.PARENT ||
                                state.screen == ChildScreen.PARENT_LOGIN
                            ) {
                                "家长工作台"
                            } else {
                                "数学训练"
                            },
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = state.today?.localDate ?: "正在获取今日任务",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (state.busyAction != null) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(24.dp),
                            strokeWidth = 2.dp,
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    IconButton(onClick = viewModel::refresh, enabled = state.busyAction == null) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新")
                    }
                    IconButton(
                        onClick = if (
                            state.screen == ChildScreen.PARENT ||
                            state.screen == ChildScreen.PARENT_LOGIN
                        ) {
                            viewModel::exitParent
                        } else {
                            viewModel::logout
                        },
                        enabled = state.busyAction == null,
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Logout,
                            contentDescription = "退出登录",
                        )
                    }
                }
                if (state.usingCachedData) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.secondaryContainer)
                            .padding(horizontal = 20.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Default.CloudOff,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        Text("当前显示离线缓存", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        },
        bottomBar = {
            if (LocalConfiguration.current.screenWidthDp < 600) {
                ChildBottomBar(state.screen, viewModel)
            }
        },
    ) { padding ->
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            if (maxWidth >= 600.dp) {
                Row(Modifier.fillMaxSize()) {
                    ChildNavigationRail(state.screen, viewModel)
                    VerticalDivider(
                        modifier = Modifier
                            .fillMaxHeight()
                            .width(1.dp),
                    )
                    ScreenContent(
                        state,
                        viewModel,
                        onBiometricParentUnlock,
                        Modifier.weight(1f),
                    )
                }
            } else {
                ScreenContent(
                    state,
                    viewModel,
                    onBiometricParentUnlock,
                    Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Composable
private fun ChildNavigationRail(screen: ChildScreen, viewModel: ChildViewModel) {
    NavigationRail(
        modifier = Modifier
            .fillMaxHeight()
            .width(96.dp),
    ) {
        Spacer(Modifier.height(12.dp))
        NavigationRailItem(
            selected = screen == ChildScreen.HOME,
            onClick = viewModel::showHome,
            icon = { Icon(Icons.Default.Home, contentDescription = null) },
            label = { Text("今日") },
            alwaysShowLabel = true,
        )
        NavigationRailItem(
            selected = screen == ChildScreen.TASKS,
            onClick = viewModel::showTasks,
            icon = {
                Icon(Icons.AutoMirrored.Filled.ListAlt, contentDescription = null)
            },
            label = { Text("任务") },
            alwaysShowLabel = true,
        )
        NavigationRailItem(
            selected = screen == ChildScreen.TRAINING,
            onClick = viewModel::openTraining,
            icon = { Icon(Icons.Default.EditNote, contentDescription = null) },
            label = { Text("训练") },
            alwaysShowLabel = true,
        )
        NavigationRailItem(
            selected = screen == ChildScreen.WRONG_BOOK,
            onClick = viewModel::showWrongBook,
            icon = { Icon(Icons.Default.HistoryEdu, contentDescription = null) },
            label = { Text("错题") },
            alwaysShowLabel = true,
        )
        Spacer(Modifier.weight(1f))
        NavigationRailItem(
            selected =
                screen == ChildScreen.PARENT_LOGIN || screen == ChildScreen.PARENT,
            onClick = viewModel::showParentGate,
            icon = {
                Icon(Icons.Default.AdminPanelSettings, contentDescription = null)
            },
            label = { Text("家长") },
            alwaysShowLabel = true,
        )
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun ChildBottomBar(screen: ChildScreen, viewModel: ChildViewModel) {
    NavigationBar(modifier = Modifier.navigationBarsPadding()) {
        NavigationBarItem(
            selected = screen == ChildScreen.HOME,
            onClick = viewModel::showHome,
            icon = { Icon(Icons.Default.Home, contentDescription = null) },
            label = { Text("今日") },
        )
        NavigationBarItem(
            selected = screen == ChildScreen.TASKS,
            onClick = viewModel::showTasks,
            icon = {
                Icon(Icons.AutoMirrored.Filled.ListAlt, contentDescription = null)
            },
            label = { Text("任务") },
        )
        NavigationBarItem(
            selected = screen == ChildScreen.TRAINING,
            onClick = viewModel::openTraining,
            icon = { Icon(Icons.Default.EditNote, contentDescription = null) },
            label = { Text("训练") },
        )
        NavigationBarItem(
            selected = screen == ChildScreen.WRONG_BOOK,
            onClick = viewModel::showWrongBook,
            icon = { Icon(Icons.Default.HistoryEdu, contentDescription = null) },
            label = { Text("错题") },
        )
        NavigationBarItem(
            selected =
                screen == ChildScreen.PARENT_LOGIN || screen == ChildScreen.PARENT,
            onClick = viewModel::showParentGate,
            icon = {
                Icon(Icons.Default.AdminPanelSettings, contentDescription = null)
            },
            label = { Text("家长") },
        )
    }
}

@Composable
private fun ScreenContent(
    state: ChildUiState,
    viewModel: ChildViewModel,
    onBiometricParentUnlock: (() -> Unit) -> Unit,
    modifier: Modifier,
) {
    when (state.screen) {
        ChildScreen.HOME -> HomeScreen(state, viewModel, modifier)
        ChildScreen.TASKS -> TasksScreen(state, viewModel, modifier)
        ChildScreen.TRAINING -> TrainingScreen(state, viewModel, modifier)
        ChildScreen.WRONG_BOOK -> WrongBookScreen(state, viewModel, modifier)
        ChildScreen.PARENT_LOGIN -> ParentLoginScreen(
            state = state,
            viewModel = viewModel,
            onBiometricParentUnlock = onBiometricParentUnlock,
            modifier = modifier,
        )
        ChildScreen.PARENT -> ParentScreen(state, viewModel, modifier)
    }
}

@Composable
private fun HomeScreen(
    state: ChildUiState,
    viewModel: ChildViewModel,
    modifier: Modifier = Modifier,
) {
    val today = state.today
    LazyColumn(
        modifier = modifier
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 28.dp),
        contentPadding = PaddingValues(vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        item {
            Text(
                text = today?.title ?: "今日数学训练",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                text = if (today?.questions.isNullOrEmpty()) {
                    "今天暂时没有待完成题目"
                } else {
                    "已完成 ${state.completedQuestionIds.size} / ${today!!.questions.size} 题"
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (today != null && today.questions.isNotEmpty()) {
            item {
                val ratio = state.completedQuestionIds.size.toFloat() / today.questions.size
                LinearProgressIndicator(
                    progress = { ratio },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp),
                )
            }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    SummaryTile(
                        title = "${today.estimatedMinutes} 分钟",
                        subtitle = "预计用时",
                        modifier = Modifier.weight(1f),
                    )
                    SummaryTile(
                        title = "${max(0, today.budget.remainingSeconds / 60)} 分钟",
                        subtitle = "剩余时间",
                        modifier = Modifier.weight(1f),
                    )
                    SummaryTile(
                        title = "${state.wrongBook?.items?.size ?: 0} 题",
                        subtitle = "待复习错题",
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            item {
                Button(
                    onClick = viewModel::openTraining,
                    enabled = state.busyAction == null && !today.budget.sessionClosed,
                    modifier = Modifier.height(52.dp),
                ) {
                    Text(if (today.activeAttempt != null) "继续作答" else "进入训练")
                    Spacer(Modifier.width(8.dp))
                    Icon(
                        Icons.AutoMirrored.Filled.ArrowForward,
                        contentDescription = null,
                    )
                }
            }
        }
        if (state.pendingCount > 0) {
            item {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Text(
                        text = "${state.pendingCount} 份答案等待联网同步",
                        modifier = Modifier.padding(16.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun SummaryTile(title: String, subtitle: String, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.height(88.dp),
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun TrainingScreen(
    state: ChildUiState,
    viewModel: ChildViewModel,
    modifier: Modifier = Modifier,
) {
    val today = state.today
    val question = today?.questions?.getOrNull(state.questionIndex)
    if (today == null || question == null) {
        EmptyState("今天没有待完成的训练题", modifier)
        return
    }

    LazyColumn(
        modifier = modifier
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 28.dp),
        contentPadding = PaddingValues(vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "第 ${state.questionIndex + 1} / ${today.questions.size} 题",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f),
                )
                BudgetTimer(today.budget)
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    if (question.questionType == "subjective") "主观题" else "单选题",
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.labelLarge,
                )
                Text(
                    "难度 ${question.difficulty}",
                    color = MaterialTheme.colorScheme.tertiary,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
        item {
            Text(
                question.stem,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Medium,
            )
        }

        val draft = state.draft
        if (draft == null) {
            item {
                Button(
                    onClick = { viewModel.openQuestion(state.questionIndex) },
                    enabled = state.busyAction == null,
                    modifier = Modifier.height(52.dp),
                ) {
                    Text("开始作答")
                }
            }
            return@LazyColumn
        }

        if (question.questionType == "single_choice") {
            items(question.options) { option ->
                val selected = draft.selectedOption == option.key
                Surface(
                    onClick = {
                        viewModel.changeAnswer(option.key, option.key)
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(8.dp),
                    color = if (selected) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surface
                    },
                    border = BorderStroke(
                        if (selected) 2.dp else 1.dp,
                        if (selected) {
                            MaterialTheme.colorScheme.primary
                        } else {
                            MaterialTheme.colorScheme.outlineVariant
                        },
                    ),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            option.key,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.width(32.dp),
                        )
                        Text(option.text, modifier = Modifier.weight(1f))
                    }
                }
            }
        } else {
            item {
                HandwritingPad(
                    handwritingJson = draft.handwritingJson,
                    onChange = viewModel::changeHandwriting,
                )
            }
            item {
                OutlinedTextField(
                    value = draft.answer,
                    onValueChange = { viewModel.changeAnswer(it) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(132.dp),
                    label = { Text("答案与关键步骤") },
                )
            }
        }

        if (draft.hintText != null) {
            item {
                Surface(
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Text(
                            "第 ${draft.hintLevel} 级提示",
                            fontWeight = FontWeight.SemiBold,
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(draft.hintText)
                    }
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(
                    onClick = viewModel::requestHint,
                    enabled = state.busyAction == null && draft.hintLevel < 3,
                    modifier = Modifier.height(52.dp),
                ) {
                    Icon(Icons.Default.Lightbulb, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (state.busyAction == "hint") "正在生成提示" else "获取提示")
                }
                Button(
                    onClick = viewModel::submitAnswer,
                    enabled = draft.answer.isNotBlank() &&
                        state.busyAction == null &&
                        draft.questionId !in state.queuedQuestionIds,
                    modifier = Modifier.height(52.dp),
                ) {
                    Icon(Icons.Default.CheckCircle, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(if (state.busyAction == "submit") "正在判定" else "提交答案")
                }
            }
        }
    }
}

@Composable
private fun HandwritingPad(
    handwritingJson: String,
    onChange: (String) -> Unit,
) {
    val gson = remember { Gson() }
    val strokeType = remember {
        object : TypeToken<List<List<StrokePoint>>>() {}.type
    }
    var strokes by remember(handwritingJson) {
        mutableStateOf(
            runCatching {
                gson.fromJson<List<List<StrokePoint>>>(handwritingJson, strokeType)
            }.getOrNull().orEmpty(),
        )
    }

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Default.Draw,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "手写草稿",
                modifier = Modifier.weight(1f),
                fontWeight = FontWeight.SemiBold,
            )
            IconButton(
                onClick = {
                    strokes = emptyList()
                    onChange("[]")
                },
                enabled = strokes.isNotEmpty(),
            ) {
                Icon(Icons.Default.Delete, contentDescription = "清空手写")
            }
        }
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(260.dp)
                .background(
                    MaterialTheme.colorScheme.surface,
                    RoundedCornerShape(8.dp),
                )
                .pointerInput(handwritingJson) {
                    detectDragGestures(
                        onDragStart = { offset ->
                            strokes = strokes + listOf(
                                listOf(StrokePoint(offset.x, offset.y)),
                            )
                        },
                        onDrag = { change, _ ->
                            val current = strokes.lastOrNull().orEmpty() +
                                StrokePoint(change.position.x, change.position.y)
                            strokes = strokes.dropLast(1) + listOf(current)
                        },
                        onDragEnd = {
                            onChange(gson.toJson(strokes, strokeType))
                        },
                    )
                },
        ) {
            strokes.forEach { stroke ->
                if (stroke.size == 1) {
                    val point = stroke.first()
                    drawCircle(
                        color = Color(0xFF202522),
                        radius = 2.5.dp.toPx(),
                        center = androidx.compose.ui.geometry.Offset(point.x, point.y),
                    )
                } else {
                    val path = Path().apply {
                        val first = stroke.first()
                        moveTo(first.x, first.y)
                        stroke.drop(1).forEach { point ->
                            lineTo(point.x, point.y)
                        }
                    }
                    drawPath(
                        path = path,
                        color = Color(0xFF202522),
                        style = Stroke(
                            width = 4.dp.toPx(),
                            cap = StrokeCap.Round,
                        ),
                    )
                }
            }
        }
    }
}

@Composable
private fun TasksScreen(
    state: ChildUiState,
    viewModel: ChildViewModel,
    modifier: Modifier = Modifier,
) {
    val snapshot = state.tasks
    val tasks = snapshot?.tasks.orEmpty().filter { it.status != "cancelled" }
    LazyColumn(
        modifier = modifier
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 28.dp),
        contentPadding = PaddingValues(vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                "我的任务",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "建议 ${snapshot?.workload?.recommendedMinutes ?: 0} 分钟",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (tasks.isEmpty()) {
            item {
                Text(
                    "当前没有待办任务",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        } else {
            items(tasks, key = LearningTask::id) { task ->
                LearningTaskCard(
                    task = task,
                    busy = state.busyAction == "task:${task.id}",
                    actionLabel = if (task.status == "pending") "我完成了" else null,
                    onAction = { viewModel.claimTaskDone(task.id) },
                )
            }
        }
    }
}

@Composable
private fun ParentLoginScreen(
    state: ChildUiState,
    viewModel: ChildViewModel,
    onBiometricParentUnlock: (() -> Unit) -> Unit,
    modifier: Modifier = Modifier,
) {
    var password by rememberSaveable { mutableStateOf("") }
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp)
                .width(520.dp),
            shape = RoundedCornerShape(8.dp),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        ) {
            Column(
                modifier = Modifier.padding(28.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Icon(
                    Icons.Default.AdminPanelSettings,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(36.dp),
                )
                Text(
                    "家长认证",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it.take(128) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("家长密码") },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    enabled = state.busyAction == null,
                )
                Button(
                    onClick = { viewModel.loginParent(password) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp),
                    enabled = password.isNotBlank() && state.busyAction == null,
                ) {
                    Icon(Icons.Default.LockOpen, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("进入家长模式")
                }
                if (state.parentSessionAvailable) {
                    OutlinedButton(
                        onClick = {
                            onBiometricParentUnlock(viewModel::unlockParentSession)
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp),
                        enabled = state.busyAction == null,
                    ) {
                        Icon(Icons.Default.Lock, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("使用生物识别")
                    }
                }
            }
        }
    }
}

@Composable
private fun ParentScreen(
    state: ChildUiState,
    viewModel: ChildViewModel,
    modifier: Modifier = Modifier,
) {
    val report = state.weeklyReport
    val tasks = state.parentTasks?.tasks.orEmpty()
    LazyColumn(
        modifier = modifier
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 28.dp),
        contentPadding = PaddingValues(vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Text(
                "任务核验与周报",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "${tasks.count { it.status == "claimed_done" }} 项等待核验",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (report != null) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    SummaryTile(
                        title = report.overview.attempts.toString(),
                        subtitle = "有效作答",
                        modifier = Modifier.weight(1f),
                    )
                    SummaryTile(
                        title = report.overview.accuracy?.let {
                            "${(it * 100).toInt()}%"
                        } ?: "—",
                        subtitle = "正确率",
                        modifier = Modifier.weight(1f),
                    )
                    SummaryTile(
                        title = report.overview.mastered.toString(),
                        subtitle = "已掌握",
                        modifier = Modifier.weight(1f),
                    )
                }
            }
            if (report.suggestions.isNotEmpty()) {
                item {
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.secondaryContainer,
                    ) {
                        Column(
                            Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text("本周建议", fontWeight = FontWeight.SemiBold)
                            report.suggestions.forEach { Text("• $it") }
                        }
                    }
                }
            }
        }
        items(tasks, key = LearningTask::id) { task ->
            LearningTaskCard(
                task = task,
                busy = state.busyAction == "parent-task:${task.id}",
                actionLabel =
                    if (task.status == "claimed_done") "核验完成" else null,
                onAction = { viewModel.verifyTask(task.id) },
            )
        }
    }
}

@Composable
private fun LearningTaskCard(
    task: LearningTask,
    busy: Boolean,
    actionLabel: String?,
    onAction: () -> Unit,
) {
    Card(
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.padding(17.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                "${task.subject} · ${task.kind}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                task.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            if (task.description.isNotBlank()) {
                Text(
                    task.description,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                "${task.estimatedMinutes} 分钟 · ${taskStatusLabel(task.status)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (actionLabel != null) {
                Button(
                    onClick = onAction,
                    enabled = !busy,
                    modifier = Modifier.height(44.dp),
                ) {
                    Icon(Icons.Default.CheckCircle, contentDescription = null)
                    Spacer(Modifier.width(7.dp))
                    Text(actionLabel)
                }
            }
        }
    }
}

private fun taskStatusLabel(status: String): String =
    when (status) {
        "pending" -> "待完成"
        "claimed_done" -> "待家长核验"
        "verified" -> "已完成"
        else -> "已取消"
    }

@Composable
private fun BudgetTimer(budget: TrainingBudget) {
    var remaining by remember(budget.remainingSeconds) {
        mutableIntStateOf(budget.remainingSeconds)
    }
    LaunchedEffect(budget.serverStartedAt, budget.remainingSeconds) {
        if (budget.serverStartedAt != null) {
            while (remaining > 0) {
                delay(1_000)
                remaining -= 1
            }
        }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            Icons.Default.Timer,
            contentDescription = null,
            modifier = Modifier.size(19.dp),
            tint = if (remaining < 300) {
                MaterialTheme.colorScheme.error
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
        Spacer(Modifier.width(5.dp))
        Text(
            "%02d:%02d".format(remaining / 60, remaining % 60),
            style = MaterialTheme.typography.titleMedium,
        )
    }
}

@Composable
private fun WrongBookScreen(
    state: ChildUiState,
    viewModel: ChildViewModel,
    modifier: Modifier = Modifier,
) {
    val items = state.wrongBook?.items.orEmpty()
    if (items.isEmpty()) {
        EmptyState("当前没有待复习错题", modifier)
        return
    }
    LazyColumn(
        modifier = modifier
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 28.dp),
        contentPadding = PaddingValues(vertical = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                "错题复习",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "待复习 ${items.size} 题",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        items(items, key = WrongItem::id) { item ->
            WrongItemCard(
                item = item,
                busy = state.busyAction == "review:${item.id}",
                onReview = { correct -> viewModel.reviewWrongItem(item.id, correct) },
            )
        }
    }
}

@Composable
private fun WrongItemCard(
    item: WrongItem,
    busy: Boolean,
    onReview: (Boolean) -> Unit,
) {
    Card(
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                listOfNotNull(item.chapter, item.knowledgePointName).joinToString(" · ")
                    .ifBlank { "待确认知识点" },
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                item.stem,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Medium,
            )
            if (!item.studentAnswer.isNullOrBlank()) {
                Text(
                    "上次作答：${item.studentAnswer}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                "已复习 ${item.reviewCount} 次 · 连续独立完成 ${item.correctReviewStreak} 次",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    onClick = { onReview(false) },
                    enabled = !busy,
                ) {
                    Text("还没解出")
                }
                FilledTonalButton(
                    onClick = { onReview(true) },
                    enabled = !busy,
                ) {
                    Text("已独立解出")
                }
            }
        }
    }
}

@Composable
private fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(24.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
