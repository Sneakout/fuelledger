import SwiftUI
import GoogleSignIn
import GoogleSignInSwift

struct SignInView: View {
    @Environment(AppSession.self) private var session
    @State private var email = ""
    @State private var password = ""
    @State private var signingIn = false
    @State private var message: String?
    @FocusState private var focusedField: Field?

    private enum Field { case email, password }

    var body: some View {
        ZStack {
            FuelNerveTheme.forest.ignoresSafeArea()
            Circle()
                .fill(FuelNerveTheme.lime.opacity(0.1))
                .frame(width: 330, height: 330)
                .blur(radius: 2)
                .offset(x: 190, y: -360)
            Circle()
                .fill(Color.white.opacity(0.04))
                .frame(width: 280, height: 280)
                .offset(x: -190, y: 390)

            GeometryReader { proxy in
                ScrollView {
                    VStack {
                        Spacer(minLength: 24)
                        signInCard
                        Spacer(minLength: 24)
                    }
                    .frame(maxWidth: 520)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: proxy.size.height)
                    .padding(.horizontal, 16)
                }
                .scrollDismissesKeyboard(.interactively)
            }
        }
    }

    private var signInCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: "fuelpump.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(FuelNerveTheme.forest)
                    .frame(width: 46, height: 46)
                    .background(FuelNerveTheme.lime, in: RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 1) {
                    Text("FuelNerve").font(.title3.bold()).foregroundStyle(FuelNerveTheme.forest)
                    Text("EVERY LITRE · EVERY RUPEE")
                        .font(.system(size: 8, weight: .bold)).tracking(1.1).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "checkmark.shield.fill").foregroundStyle(FuelNerveTheme.green)
            }

            Divider().opacity(0.65)

            VStack(alignment: .leading, spacing: 3) {
                Text("WELCOME BACK")
                    .font(.caption.weight(.bold)).tracking(1.6).foregroundStyle(FuelNerveTheme.green)
                Text("Sign in to your station")
                    .font(.system(size: 26, weight: .bold, design: .rounded)).foregroundStyle(FuelNerveTheme.forest)
                Text("Continue securely to your FuelNerve workspace.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }

            VStack(alignment: .leading, spacing: 12) {
                signInField(title: "Email or mobile number", symbol: "person.crop.circle") {
                    TextField("Enter email or mobile number", text: $email)
                        .textContentType(.username).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .focused($focusedField, equals: .email).submitLabel(.next)
                        .onSubmit { focusedField = .password }
                }
                signInField(title: "Password", symbol: "lock") {
                    SecureField("Enter your password", text: $password)
                        .textContentType(.password).focused($focusedField, equals: .password)
                        .submitLabel(.go).onSubmit { if canSignIn { signIn() } }
                }
            }

            if let message {
                Label(message, systemImage: "exclamationmark.circle.fill")
                    .font(.callout).foregroundStyle(Color.red)
                    .accessibilityLabel("Sign-in error: \(message)")
            }

            Button { signIn() } label: {
                Group {
                    if signingIn { ProgressView().tint(.white) }
                    else { Text("Sign in securely").fontWeight(.bold) }
                }
                .frame(maxWidth: .infinity).frame(height: 48)
            }
            .buttonStyle(.plain).foregroundStyle(FuelNerveTheme.forest)
            .background(canSignIn ? FuelNerveTheme.lime : Color.secondary.opacity(0.18), in: RoundedRectangle(cornerRadius: 15))
            .disabled(!canSignIn)

            HStack(spacing: 9) {
                Rectangle().fill(Color.secondary.opacity(0.16)).frame(height: 1)
                Text("or").font(.caption).foregroundStyle(.secondary)
                Rectangle().fill(Color.secondary.opacity(0.16)).frame(height: 1)
            }

            GoogleSignInButton(scheme: .light, style: .wide, state: signingIn ? .disabled : .normal) { signInWithGoogle() }
                .frame(height: 48).clipShape(RoundedRectangle(cornerRadius: 13)).disabled(signingIn)

            if session.environment.name != .production {
                environmentLabel.frame(maxWidth: .infinity).padding(.top, 2)
            }
        }
        .padding(22)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        .shadow(color: Color.black.opacity(0.16), radius: 30, y: 14)
    }

    private func signInField<Content: View>(title: String, symbol: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(FuelNerveTheme.forest)
            HStack(spacing: 13) {
                Image(systemName: symbol).font(.body.weight(.medium)).foregroundStyle(Color.secondary)
                    .frame(width: 22)
                content()
            }
            .padding(.horizontal, 12).frame(height: 46)
            .background(FuelNerveTheme.canvas, in: RoundedRectangle(cornerRadius: 15))
            .overlay(RoundedRectangle(cornerRadius: 15).stroke(FuelNerveTheme.green.opacity(0.22)))
        }
    }

    private var environmentLabel: some View {
        HStack(spacing: 7) {
            Circle().fill(session.environment.name == .production ? FuelNerveTheme.green : FuelNerveTheme.gold).frame(width: 7, height: 7)
            Text("\(session.environment.name.rawValue.capitalized) environment")
        }
        .font(.caption.weight(.medium)).foregroundStyle(.secondary)
    }

    private var canSignIn: Bool {
        !signingIn && !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && password.count >= 8
    }

    private func signIn() {
        signingIn = true; message = nil
        Task {
            do { try await session.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), password: password) }
            catch APIError.unauthenticated { message = "Email, mobile number or password is incorrect." }
            catch let error as URLError where [.cannotConnectToHost, .timedOut, .networkConnectionLost, .notConnectedToInternet].contains(error.code) {
                message = "FuelNerve cannot reach the server. Check your connection and try again."
            }
            catch APIError.server(_, _, let serverMessage) {
                message = serverMessage ?? "FuelNerve could not sign you in. Please try again."
            }
            catch { message = "FuelNerve could not sign you in. Please try again." }
            signingIn = false
        }
    }

    private func signInWithGoogle() {
        guard let presenting = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .flatMap({ $0.windows })
            .first(where: { $0.isKeyWindow })?.rootViewController else {
            message = "Google sign-in is temporarily unavailable."
            return
        }
        signingIn = true; message = nil
        Task {
            do {
                let result = try await GIDSignIn.sharedInstance.signIn(withPresenting: presenting)
                guard let credential = result.user.idToken?.tokenString else { throw APIError.invalidResponse }
                try await session.loginWithGoogle(credential: credential)
            } catch let error as GIDSignInError where error.code == .canceled {
                // Closing Google's sheet is an expected choice, not an error.
            } catch APIError.unauthenticated {
                message = "Google could not verify this FuelNerve account."
            } catch APIError.server(_, let code, let serverMessage) {
                switch code {
                case "GOOGLE_AUTH_UNAVAILABLE":
                    message = "Google sign-in is not configured on this FuelNerve server."
                case "GOOGLE_TOKEN_INVALID":
                    message = "Google could not verify this FuelNerve account."
                default:
                    message = serverMessage ?? "FuelNerve could not complete Google sign-in. Please try again."
                }
            } catch let error as URLError where error.code == .cannotConnectToHost || error.code == .timedOut || error.code == .networkConnectionLost {
                message = "FuelNerve’s local server is offline. Start it and try again."
            } catch {
                message = "FuelNerve could not complete Google sign-in. Please try again."
            }
            signingIn = false
        }
    }
}

struct ChangePasswordView: View {
    @Environment(AppSession.self) private var session
    @State private var password = ""
    @State private var confirmation = ""
    @State private var saving = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            Form {
                Section { Text("Your temporary password must be replaced before opening FuelNerve.").foregroundStyle(.secondary) }
                Section("Create your private password") {
                    SecureField("New password", text: $password).textContentType(.newPassword)
                    SecureField("Confirm password", text: $confirmation).textContentType(.newPassword)
                    Text("Use at least 8 characters, one uppercase letter and one number.").font(.caption).foregroundStyle(.secondary)
                }
                if let message { Section { Text(message).foregroundStyle(.red) } }
                Button(saving ? "Saving…" : "Continue to FuelNerve") { updatePassword() }
                    .disabled(saving || !validPassword || password != confirmation)
            }
            .navigationTitle("Secure your account")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Sign out") { Task { await session.logout() } } } }
        }
    }

    private var validPassword: Bool {
        password.count >= 8 && password.contains(where: { $0.isUppercase }) && password.contains(where: { $0.isNumber })
    }

    private func updatePassword() {
        saving = true; message = nil
        Task {
            do { try await session.changePassword(password) }
            catch {
                session.handleAuthenticationFailure(error)
                if session.state != .signedOut { message = "Your password could not be changed. Please review it and try again." }
            }
            saving = false
        }
    }
}
