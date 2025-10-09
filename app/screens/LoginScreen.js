import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import api from "../../constants/api";
import { useRouter } from "expo-router";

export default function LoginScreen() {
  const router = useRouter();

  // nav-once guard to prevent stacking multiple screens
  const navLockRef = useRef(false);
  const navigateOnceReplace = (path) => {
    if (navLockRef.current) return;
    navLockRef.current = true;
    try {
      router.replace(path);
    } finally {
      setTimeout(() => {
        navLockRef.current = false;
      }, 400);
    }
  };

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (loading) return; // guard: don't allow concurrent submits

    const u = username.trim();
    const p = password.trim();
    if (!u || !p) {
      return Alert.alert("Validation", "Username and password are required.");
    }

    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { username: u, password: p });
      await AsyncStorage.setItem("jwt", data.token);

      // Optional: store convenience fields (best-effort, fully wrapped)
      try {
        const [, payload] = String(data.token).split(".");
        const base64 = payload?.replace(/-/g, "+").replace(/_/g, "/");
        if (base64) {
          const jsonStr =
            typeof atob === "function"
              ? atob(base64)
              : Buffer.from(base64, "base64").toString("utf8");
          const decoded = JSON.parse(jsonStr);
          if (decoded?.username) await AsyncStorage.setItem("username", String(decoded.username));
          if (decoded?.role) await AsyncStorage.setItem("role", String(decoded.role));
        }
      } catch {
        // ignore decode issues; token is already saved
      }

      // Top-level route => replace (not push) and guarded
      navigateOnceReplace("/screens/WorkOrdersScreen");
    } catch (err) {
      console.error("Login error", err);
      const msg =
        err?.response?.status === 401
          ? "Invalid username or password."
          : err?.response?.data?.error || err?.message || "Network error";
      Alert.alert("Login failed", msg);
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = !loading && username.length > 0 && password.length > 0;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tech Login</Text>

      <TextInput
        style={styles.input}
        placeholder="Username"
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={setUsername}
        editable={!loading}
        returnKeyType="next"
        // no navigation here; just move focus via keyboard UI
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        value={password}
        onChangeText={setPassword}
        editable={!loading}
        returnKeyType="go"
        onSubmitEditing={() => {
          if (canSubmit) handleLogin(); // submit once; nav guard prevents stacking
        }}
      />

      {loading ? (
        <ActivityIndicator size="large" color="#007bff" />
      ) : (
        <TouchableOpacity
          style={[styles.button, !canSubmit && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={!canSubmit}
        >
          <Text style={styles.buttonText}>Log In</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#F1F5F9",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 24,
    textAlign: "center",
    color: "#2B2D42",
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  button: {
    backgroundColor: "#007bff",
    padding: 14,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 12,
  },
  buttonDisabled: {
    backgroundColor: "#93c5fd",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
  },
});
